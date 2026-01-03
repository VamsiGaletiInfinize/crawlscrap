/**
 * CIRCUIT BREAKER SERVICE
 *
 * Implements the circuit breaker pattern to prevent repeated requests
 * to failing domains. Helps protect against cascading failures.
 *
 * States:
 * - CLOSED: Normal operation, requests allowed
 * - OPEN: Too many failures, requests blocked
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 */

import { getCircuitBreakerConfig, type CircuitBreakerConfig } from '../config/retry.js';
import { extractDomain } from './domainFilter.js';

/**
 * Circuit breaker state
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit breaker for a specific domain
 */
interface DomainCircuit {
  domain: string;
  state: CircuitState;
  failures: number[];           // Timestamps of recent failures
  successes: number;            // Success count in HALF_OPEN state
  lastFailure: number | null;   // Timestamp of last failure
  lastStateChange: number;      // Timestamp of last state change
  totalFailures: number;        // Total failures since creation
  totalSuccesses: number;       // Total successes since creation
  totalBlocked: number;         // Requests blocked due to open circuit
}

/**
 * Circuit breaker check result
 */
export interface CircuitCheckResult {
  allowed: boolean;
  state: CircuitState;
  reason?: string;
}

// Store circuits by domain
const circuits = new Map<string, DomainCircuit>();

/**
 * Get or create a circuit for a domain
 */
function getCircuit(domain: string): DomainCircuit {
  let circuit = circuits.get(domain);

  if (!circuit) {
    circuit = {
      domain,
      state: 'CLOSED',
      failures: [],
      successes: 0,
      lastFailure: null,
      lastStateChange: Date.now(),
      totalFailures: 0,
      totalSuccesses: 0,
      totalBlocked: 0,
    };
    circuits.set(domain, circuit);
  }

  return circuit;
}

/**
 * Clean up old failure timestamps outside the window
 */
function cleanupFailures(circuit: DomainCircuit, config: CircuitBreakerConfig): void {
  const cutoff = Date.now() - config.failureWindowMs;
  circuit.failures = circuit.failures.filter(ts => ts > cutoff);
}

/**
 * Check if a request to a URL should be allowed
 */
export function checkCircuit(url: string): CircuitCheckResult {
  const config = getCircuitBreakerConfig();

  if (!config.enabled) {
    return { allowed: true, state: 'CLOSED' };
  }

  const domain = extractDomain(url);
  if (!domain) {
    return { allowed: true, state: 'CLOSED' };
  }

  const circuit = getCircuit(domain);
  const now = Date.now();

  // Clean up old failures
  cleanupFailures(circuit, config);

  switch (circuit.state) {
    case 'CLOSED':
      // Normal operation
      return { allowed: true, state: 'CLOSED' };

    case 'OPEN':
      // Check if reset timeout has passed
      const timeSinceStateChange = now - circuit.lastStateChange;
      if (timeSinceStateChange >= config.resetTimeoutMs) {
        // Transition to HALF_OPEN
        circuit.state = 'HALF_OPEN';
        circuit.successes = 0;
        circuit.lastStateChange = now;
        console.log(`[CIRCUIT BREAKER] ${domain}: OPEN -> HALF_OPEN (testing recovery)`);

        return { allowed: true, state: 'HALF_OPEN' };
      }

      // Still in open state, block request
      circuit.totalBlocked++;
      return {
        allowed: false,
        state: 'OPEN',
        reason: `Circuit open for ${domain}, resets in ${Math.round((config.resetTimeoutMs - timeSinceStateChange) / 1000)}s`,
      };

    case 'HALF_OPEN':
      // Allow limited requests to test recovery
      return { allowed: true, state: 'HALF_OPEN' };

    default:
      return { allowed: true, state: 'CLOSED' };
  }
}

/**
 * Record a successful request
 */
export function recordSuccess(url: string): void {
  const config = getCircuitBreakerConfig();

  if (!config.enabled) return;

  const domain = extractDomain(url);
  if (!domain) return;

  const circuit = getCircuit(domain);
  circuit.totalSuccesses++;

  if (circuit.state === 'HALF_OPEN') {
    circuit.successes++;

    // Check if we have enough successes to close the circuit
    if (circuit.successes >= config.successThreshold) {
      circuit.state = 'CLOSED';
      circuit.failures = [];
      circuit.successes = 0;
      circuit.lastStateChange = Date.now();
      console.log(`[CIRCUIT BREAKER] ${domain}: HALF_OPEN -> CLOSED (recovered)`);
    }
  }
}

/**
 * Record a failed request
 */
export function recordFailure(url: string): void {
  const config = getCircuitBreakerConfig();

  if (!config.enabled) return;

  const domain = extractDomain(url);
  if (!domain) return;

  const circuit = getCircuit(domain);
  const now = Date.now();

  circuit.failures.push(now);
  circuit.lastFailure = now;
  circuit.totalFailures++;

  // Clean up old failures
  cleanupFailures(circuit, config);

  switch (circuit.state) {
    case 'CLOSED':
      // Check if we should open the circuit
      if (circuit.failures.length >= config.failureThreshold) {
        circuit.state = 'OPEN';
        circuit.lastStateChange = now;
        console.log(
          `[CIRCUIT BREAKER] ${domain}: CLOSED -> OPEN ` +
          `(${circuit.failures.length} failures in ${config.failureWindowMs}ms)`
        );
      }
      break;

    case 'HALF_OPEN':
      // Failure in half-open state, go back to open
      circuit.state = 'OPEN';
      circuit.successes = 0;
      circuit.lastStateChange = now;
      console.log(`[CIRCUIT BREAKER] ${domain}: HALF_OPEN -> OPEN (recovery failed)`);
      break;
  }
}

/**
 * Get circuit state for a domain
 */
export function getCircuitState(url: string): DomainCircuit | null {
  const domain = extractDomain(url);
  if (!domain) return null;

  return circuits.get(domain) || null;
}

/**
 * Get all circuit states
 */
export function getAllCircuits(): DomainCircuit[] {
  return Array.from(circuits.values());
}

/**
 * Get circuit breaker statistics
 */
export function getCircuitBreakerStats(): {
  enabled: boolean;
  totalCircuits: number;
  openCircuits: number;
  halfOpenCircuits: number;
  closedCircuits: number;
  totalBlocked: number;
  circuits: Array<{
    domain: string;
    state: CircuitState;
    recentFailures: number;
    totalFailures: number;
    totalSuccesses: number;
    totalBlocked: number;
  }>;
} {
  const config = getCircuitBreakerConfig();
  const allCircuits = getAllCircuits();

  // Clean up failures for accurate stats
  allCircuits.forEach(c => cleanupFailures(c, config));

  const openCircuits = allCircuits.filter(c => c.state === 'OPEN');
  const halfOpenCircuits = allCircuits.filter(c => c.state === 'HALF_OPEN');
  const closedCircuits = allCircuits.filter(c => c.state === 'CLOSED');
  const totalBlocked = allCircuits.reduce((sum, c) => sum + c.totalBlocked, 0);

  return {
    enabled: config.enabled,
    totalCircuits: allCircuits.length,
    openCircuits: openCircuits.length,
    halfOpenCircuits: halfOpenCircuits.length,
    closedCircuits: closedCircuits.length,
    totalBlocked,
    circuits: allCircuits.map(c => ({
      domain: c.domain,
      state: c.state,
      recentFailures: c.failures.length,
      totalFailures: c.totalFailures,
      totalSuccesses: c.totalSuccesses,
      totalBlocked: c.totalBlocked,
    })),
  };
}

/**
 * Reset circuit for a domain
 */
export function resetCircuit(url: string): boolean {
  const domain = extractDomain(url);
  if (!domain) return false;

  const circuit = circuits.get(domain);
  if (!circuit) return false;

  circuit.state = 'CLOSED';
  circuit.failures = [];
  circuit.successes = 0;
  circuit.lastStateChange = Date.now();
  console.log(`[CIRCUIT BREAKER] ${domain}: Reset to CLOSED`);

  return true;
}

/**
 * Reset all circuits
 */
export function resetAllCircuits(): void {
  circuits.clear();
  console.log('[CIRCUIT BREAKER] All circuits reset');
}

/**
 * Force open a circuit for a domain (for testing/manual intervention)
 */
export function forceOpenCircuit(url: string): boolean {
  const domain = extractDomain(url);
  if (!domain) return false;

  const circuit = getCircuit(domain);
  circuit.state = 'OPEN';
  circuit.lastStateChange = Date.now();
  console.log(`[CIRCUIT BREAKER] ${domain}: Forced OPEN`);

  return true;
}

export default {
  checkCircuit,
  recordSuccess,
  recordFailure,
  getCircuitState,
  getAllCircuits,
  getCircuitBreakerStats,
  resetCircuit,
  resetAllCircuits,
  forceOpenCircuit,
};

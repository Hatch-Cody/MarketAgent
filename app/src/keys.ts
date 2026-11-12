type Stash = { agentId: string; name: string; apiKey: string };
let stash: Stash | null = null;

export function stashKey(value: Stash) {
  stash = value;
}

export function peekKey(agentId: string): Stash | null {
  return stash?.agentId === agentId ? stash : null;
}

export function clearKey() {
  stash = null;
}

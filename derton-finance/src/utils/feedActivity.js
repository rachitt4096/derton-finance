// Tracks the last time the live WebSocket delivered REAL market data (prices or
// quotes). REST polling uses this to back off only when the socket is genuinely
// streaming — not when REST itself updated the feed status.
let lastWsTickAt = 0

export const markWsTick = () => {
  lastWsTickAt = Date.now()
}

export const wsTickFreshWithin = (ms) => lastWsTickAt > 0 && Date.now() - lastWsTickAt < ms

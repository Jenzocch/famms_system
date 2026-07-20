// Shared spring presets, translated from Apple's damping/response model
// (WWDC 2018 "Designing Fluid Interfaces") into Motion's bounce/duration
// spring API. Two rules from that talk this file exists to enforce
// consistently instead of every component picking its own numbers:
//
// 1. Default to critically damped (no overshoot) for anything that isn't
//    gesture-driven — a menu fading in, a card mounting. Overshoot on
//    something that didn't carry momentum from the user's hand feels wrong.
// 2. Add a little bounce ONLY when the interaction itself carried momentum
//    (a tap release, a drag, a flick) — never on passive enter/exit.

export const springDefault = { type: 'spring' as const, bounce: 0, duration: 0.35 }
export const springMomentum = { type: 'spring' as const, bounce: 0.2, duration: 0.35 }

// Press feedback (button/card tap) — snappy, slightly bouncier than the
// default since it's the direct result of a touch, not a passive transition.
export const springPress = { type: 'spring' as const, bounce: 0.25, duration: 0.25 }

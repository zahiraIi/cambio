package game

// Policy observation and action encoding shared with Python training (ai/game_sim.py).

const (
	PolicyObsSize      = 40
	PolicyHiddenSize   = 128
	PolicyValueHidden  = 64
	PolicyMaxOpponents = 3 // fixed obs slots for up to 4-player games

	// Base actions (0–20)
	PolicyActDrawDeck     = 0
	PolicyActDrawDiscard  = 1
	PolicyActSwapBase     = 2  // 2–5: swap drawn with hand slot
	PolicyActDiscard      = 6
	PolicyActPeekOwnBase  = 7  // 7–10
	PolicyActPeekOppBase  = 11 // 11–14 (target slot; target picked from action context)
	PolicyActSwitchBase   = 15 // 15–18 (my slot; target picked from action context)
	PolicyActCallCambio   = 19
	PolicyActDeclineSw    = 20

	PolicyActSnapBase         = 21 // 21–24: snap own slot
	PolicyActStackOppBase     = 25 // 25–36: oppRel 0–2 × slot 0–3
	PolicyActStackGiveBase    = 37 // 37–40: give slot after opponent stack
	PolicyNumActions          = 41

	PolicyStackMemoryMin = 0.35
)

// PolicyActStackOppIndex returns the action index for stacking opponent relIdx's slot.
func PolicyActStackOppIndex(oppRelIdx, slot int) int {
	return PolicyActStackOppBase + oppRelIdx*HandSize + slot
}

// PolicyDecodeStackOpp returns relative opponent index and slot from action index.
func PolicyDecodeStackOpp(action int) (oppRelIdx, slot int, ok bool) {
	if action < PolicyActStackOppBase || action >= PolicyActStackGiveBase {
		return 0, 0, false
	}
	off := action - PolicyActStackOppBase
	return off / HandSize, off % HandSize, true
}

package game

// BuildBotObservation constructs the policy observation vector for a bot player.
func (e *Engine) BuildBotObservation(botID string) []float64 {
	bot := e.findPlayer(botID)
	if bot == nil {
		return make([]float64, PolicyObsSize)
	}
	botIdx := e.playerIndex(botID)
	obs := make([]float64, 0, PolicyObsSize)

	for i := 0; i < HandSize; i++ {
		card := bot.Hand[i]
		hasCard := 0.0
		known := 0.0
		pts := 0.0
		if card != nil {
			hasCard = 1.0
			if bot.Known[i] {
				known = 1.0
				pts = float64(card.Points()) / 13.0
			}
		}
		obs = append(obs, hasCard, known, pts)
	}

	unknownCount := 0
	knownTotal := 0
	for i := 0; i < HandSize; i++ {
		if bot.Hand[i] != nil && !bot.Known[i] {
			unknownCount++
		}
		if bot.Hand[i] != nil && bot.Known[i] {
			knownTotal += bot.Hand[i].Points()
		}
	}
	obs = append(obs, float64(knownTotal+unknownCount)*5.5/40.0)

	if len(e.DiscardPile) > 0 {
		top := e.DiscardPile[len(e.DiscardPile)-1]
		obs = append(obs, float64(top.Points())/13.0, float64(top.Ability())/4.0)
	} else {
		obs = append(obs, 0, 0)
	}

	if e.DrawnCard != nil {
		obs = append(obs, 1.0, float64(e.DrawnCard.Points())/13.0)
	} else {
		obs = append(obs, 0, 0)
	}

	obs = append(obs, float64(e.Phase)/3.0)
	isMyTurn := 0.0
	if botIdx >= 0 && e.CurrentTurn == botIdx {
		isMyTurn = 1.0
	}
	obs = append(obs, isMyTurn)
	obs = append(obs, float64(e.PendingAbility)/4.0)
	cambioCalled := 0.0
	if e.CambioCallerIdx >= 0 {
		cambioCalled = 1.0
	}
	obs = append(obs, cambioCalled)

	if e.openStackRank != 0 {
		obs = append(obs, float64(e.openStackRank)/13.0)
	} else {
		obs = append(obs, 0)
	}
	if e.stackRankClaimed {
		obs = append(obs, 1)
	} else {
		obs = append(obs, 0)
	}
	if e.openStackRank != 0 && !e.stackRankClaimed {
		obs = append(obs, 1)
	} else {
		obs = append(obs, 0)
	}

	opps := e.opponentIndices(botIdx)
	for rel := 0; rel < PolicyMaxOpponents; rel++ {
		if rel < len(opps) {
			opp := e.Players[opps[rel]]
			for slot := 0; slot < HandSize; slot++ {
				rank, strength, ok := e.getPeekKnowledge(botID, opp.ID, slot)
				if ok {
					obs = append(obs, float64(rank)/13.0*strength)
				} else {
					obs = append(obs, 0)
				}
			}
		} else {
			for slot := 0; slot < HandSize; slot++ {
				obs = append(obs, 0)
			}
		}
	}

	for rel := 0; rel < PolicyMaxOpponents; rel++ {
		if rel < len(opps) {
			obs = append(obs, float64(e.Players[opps[rel]].ActiveCardCount())/4.0)
		} else {
			obs = append(obs, 0)
		}
	}

	deckRem := 0
	if e.Deck != nil {
		deckRem = e.Deck.Remaining()
	}
	obs = append(obs, float64(deckRem)/54.0)

	for len(obs) < PolicyObsSize {
		obs = append(obs, 0)
	}
	return obs[:PolicyObsSize]
}

func (e *Engine) playerIndex(playerID string) int {
	for i, p := range e.Players {
		if p.ID == playerID {
			return i
		}
	}
	return -1
}

func (e *Engine) opponentIndices(playerIdx int) []int {
	var out []int
	for i := range e.Players {
		if i != playerIdx {
			out = append(out, i)
		}
	}
	return out
}

// ValidBotActionIndices returns legal policy action indices for a bot.
func (e *Engine) ValidBotActionIndices(botID string) []int {
	bot := e.findPlayer(botID)
	if bot == nil {
		return nil
	}
	botIdx := e.playerIndex(botID)

	if e.Phase == PhaseInitPeek {
		mask := e.InitPeekMask[botID]
		var valid []int
		for s := InitPeekSlotMin; s <= InitPeekSlotMax; s++ {
			bit := uint8(1 << s)
			if mask&bit == 0 && bot.Hand[s] != nil {
				valid = append(valid, PolicyActPeekOwnBase+s)
			}
		}
		return valid
	}

	if e.Phase == PhaseScoring || e.Phase == PhaseWaiting {
		return nil
	}

	if e.pendingStackGiveActor == botID {
		var valid []int
		for s := 0; s < HandSize; s++ {
			if bot.Hand[s] != nil {
				valid = append(valid, PolicyActStackGiveBase+s)
			}
		}
		return valid
	}

	if e.PendingAbility != NoAbility {
		if botIdx < 0 || e.CurrentTurn != botIdx {
			return nil
		}
		return e.validAbilityActions(botID, bot)
	}

	if !e.stackRankClaimed && e.openStackRank != 0 &&
		(e.Phase == PhaseTurns || e.Phase == PhaseFinalRound) {
		var snap []int
		for s := 0; s < HandSize; s++ {
			c := bot.Hand[s]
			if c != nil && c.Rank == e.openStackRank {
				if botIdx == e.CurrentTurn && e.DrawnCard != nil {
					continue
				}
				snap = append(snap, PolicyActSnapBase+s)
			}
		}
		if len(snap) > 0 {
			return snap
		}
	}

	if botIdx < 0 || e.CurrentTurn != botIdx {
		return nil
	}

	if e.DrawnCard != nil {
		valid := []int{PolicyActDiscard}
		for s := 0; s < HandSize; s++ {
			if bot.Hand[s] != nil {
				valid = append(valid, PolicyActSwapBase+s)
			}
		}
		return valid
	}

	valid := []int{PolicyActDrawDeck}
	if len(e.DiscardPile) > 0 {
		valid = append(valid, PolicyActDrawDiscard)
	}
	if e.Phase == PhaseTurns {
		valid = append(valid, PolicyActCallCambio)
	}

	if !e.stackRankClaimed && e.openStackRank != 0 {
		opps := e.opponentIndices(botIdx)
		for rel, oppIdx := range opps {
			if rel >= PolicyMaxOpponents {
				break
			}
			opp := e.Players[oppIdx]
			for slot := 0; slot < HandSize; slot++ {
				if opp.Hand[slot] == nil {
					continue
				}
				memRank, strength, ok := e.getPeekKnowledge(botID, opp.ID, slot)
				if !ok || strength < PolicyStackMemoryMin {
					continue
				}
				actual := opp.Hand[slot].Rank
				if memRank == actual && actual == e.openStackRank {
					valid = append(valid, PolicyActStackOppIndex(rel, slot))
				}
			}
		}
	}

	return valid
}

func (e *Engine) validAbilityActions(botID string, bot *Player) []int {
	switch e.PendingAbility {
	case PeekOwn:
		var valid []int
		for s := 0; s < HandSize; s++ {
			if bot.Hand[s] != nil {
				valid = append(valid, PolicyActPeekOwnBase+s)
			}
		}
		return valid
	case PeekOpponent:
		return []int{
			PolicyActPeekOppBase, PolicyActPeekOppBase + 1,
			PolicyActPeekOppBase + 2, PolicyActPeekOppBase + 3,
		}
	case BlindSwitch:
		var valid []int
		for s := 0; s < HandSize; s++ {
			if bot.Hand[s] != nil {
				valid = append(valid, PolicyActSwitchBase+s)
			}
		}
		return valid
	case LookAndSwitch:
		if e.lookSwitchMySlot < 0 {
			var valid []int
			for s := 0; s < HandSize; s++ {
				if bot.Hand[s] != nil {
					valid = append(valid, PolicyActSwitchBase+s)
				}
			}
			return valid
		}
		if !e.lookSwitchPeekDone {
			return []int{
				PolicyActPeekOppBase, PolicyActPeekOppBase + 1,
				PolicyActPeekOppBase + 2, PolicyActPeekOppBase + 3,
			}
		}
		return []int{PolicyActDeclineSw, PolicyActSwitchBase + e.lookSwitchMySlot}
	default:
		return nil
	}
}

// ActionFromPolicyIndex maps a policy action index to an engine Action.
func (e *Engine) ActionFromPolicyIndex(botID string, idx int) (Action, bool) {
	bot := e.findPlayer(botID)
	if bot == nil {
		return Action{}, false
	}
	botIdx := e.playerIndex(botID)

	if e.Phase == PhaseInitPeek {
		if idx >= PolicyActPeekOwnBase && idx < PolicyActPeekOwnBase+HandSize {
			return Action{Type: ActionInitPeek, PlayerID: botID, Slot: idx - PolicyActPeekOwnBase}, true
		}
		return Action{}, false
	}

	if e.PendingAbility == LookAndSwitch {
		if idx == PolicyActDeclineSw {
			return Action{Type: ActionDeclineSwitch, PlayerID: botID}, true
		}
		if e.lookSwitchMySlot < 0 && idx >= PolicyActSwitchBase && idx < PolicyActSwitchBase+HandSize {
			return Action{Type: ActionLookSwitchOwn, PlayerID: botID, Slot: idx - PolicyActSwitchBase}, true
		}
		if !e.lookSwitchPeekDone && idx >= PolicyActPeekOppBase && idx < PolicyActPeekOppBase+HandSize {
			return e.actionLookSwitchPeek(botID, idx-PolicyActPeekOppBase)
		}
		if e.lookSwitchPeekDone && idx >= PolicyActSwitchBase && idx < PolicyActSwitchBase+HandSize {
			return Action{
				Type: ActionLookAndSwitch, PlayerID: botID,
				Slot: e.lookSwitchMySlot, TargetID: e.lookSwitchTargetID, TargetSlot: e.lookSwitchTargetSlot,
			}, true
		}
	}
	if idx >= PolicyActStackGiveBase && idx < PolicyActStackGiveBase+HandSize {
		return Action{Type: ActionStackGive, PlayerID: botID, Slot: idx - PolicyActStackGiveBase}, true
	}
	if idx >= PolicyActSnapBase && idx < PolicyActSnapBase+HandSize {
		return Action{Type: ActionSnapMatch, PlayerID: botID, Slot: idx - PolicyActSnapBase}, true
	}
	if idx >= PolicyActStackOppBase && idx < PolicyActStackGiveBase {
		rel, slot, ok := PolicyDecodeStackOpp(idx)
		if !ok {
			return Action{}, false
		}
		opps := e.opponentIndices(botIdx)
		if rel >= len(opps) {
			return Action{}, false
		}
		target := e.Players[opps[rel]]
		return Action{
			Type: ActionStackOpponent, PlayerID: botID,
			TargetID: target.ID, TargetSlot: slot,
		}, true
	}

	switch idx {
	case PolicyActDrawDeck:
		return Action{Type: ActionDrawDeck, PlayerID: botID}, true
	case PolicyActDrawDiscard:
		return Action{Type: ActionDrawDiscard, PlayerID: botID}, true
	case PolicyActDiscard:
		return Action{Type: ActionDiscard, PlayerID: botID}, true
	case PolicyActCallCambio:
		return Action{Type: ActionCallCambio, PlayerID: botID}, true
	case PolicyActDeclineSw:
		return Action{Type: ActionDeclineSwitch, PlayerID: botID}, true
	}

	if idx >= PolicyActSwapBase && idx < PolicyActSwapBase+HandSize {
		return Action{Type: ActionSwapCard, PlayerID: botID, Slot: idx - PolicyActSwapBase}, true
	}
	if idx >= PolicyActPeekOwnBase && idx < PolicyActPeekOwnBase+HandSize {
		return Action{Type: ActionPeekOwn, PlayerID: botID, Slot: idx - PolicyActPeekOwnBase}, true
	}
	if idx >= PolicyActPeekOppBase && idx < PolicyActPeekOppBase+HandSize {
		return e.actionPeekOpponent(botID, idx-PolicyActPeekOppBase)
	}
	if idx >= PolicyActSwitchBase && idx < PolicyActSwitchBase+HandSize {
		return e.actionSwitch(botID, bot, idx-PolicyActSwitchBase)
	}

	return Action{}, false
}

func (e *Engine) actionLookSwitchPeek(botID string, targetSlot int) (Action, bool) {
	var candidates []*Player
	for _, p := range e.Players {
		if p.ID != botID && p.ActiveCardCount() > 0 {
			candidates = append(candidates, p)
		}
	}
	if len(candidates) == 0 {
		return Action{}, false
	}
	target := candidates[0]
	if target.Hand[targetSlot] == nil {
		for s := 0; s < HandSize; s++ {
			if target.Hand[s] != nil {
				targetSlot = s
				break
			}
		}
	}
	return Action{
		Type: ActionLookSwitchPeek, PlayerID: botID,
		TargetID: target.ID, TargetSlot: targetSlot,
	}, true
}

func (e *Engine) actionPeekOpponent(botID string, targetSlot int) (Action, bool) {
	var candidates []*Player
	for _, p := range e.Players {
		if p.ID != botID && p.ActiveCardCount() > 0 {
			candidates = append(candidates, p)
		}
	}
	if len(candidates) == 0 {
		return Action{}, false
	}
	target := candidates[0]
	if target.Hand[targetSlot] == nil {
		for s := 0; s < HandSize; s++ {
			if target.Hand[s] != nil {
				targetSlot = s
				break
			}
		}
	}
	return Action{
		Type: ActionPeekOpponent, PlayerID: botID,
		TargetID: target.ID, TargetSlot: targetSlot,
	}, true
}

func (e *Engine) actionSwitch(botID string, bot *Player, mySlot int) (Action, bool) {
	var oppCandidates []struct {
		p *Player
		s []int
	}
	for _, p := range e.Players {
		if p.ID == botID {
			continue
		}
		ss := slotsWithCards(p)
		if len(ss) > 0 {
			oppCandidates = append(oppCandidates, struct {
				p *Player
				s []int
			}{p, ss})
		}
	}
	if len(oppCandidates) == 0 || bot.Hand[mySlot] == nil {
		return Action{}, false
	}
	ch := oppCandidates[0]
	ts := ch.s[0]
	actType := ActionBlindSwitch
	if e.PendingAbility == LookAndSwitch {
		actType = ActionLookAndSwitch
	}
	return Action{
		Type: actType, PlayerID: botID,
		Slot: mySlot, TargetID: ch.p.ID, TargetSlot: ts,
	}, true
}

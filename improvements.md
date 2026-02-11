# Magic Draft Simulator - Melhorias Pendentes

## 1. IA de Gameplay (game-ai.js)

### 1.1 Prioridade de Combate Completa
- [x] Adicionar fase de prioridade APOS declarar bloqueadores (antes do dano) ✓
  - _scoreInstant agora pontua post_attackers e post_blockers
  - IA avalia tap/remove/bounce de atacantes, combat tricks apos blockers
  - _tryActivatedAbilitiesInCombat usa habilidades ativadas em janelas de combate
- [x] Prioridade entre declare attackers e declare blockers tambem ✓
- [x] IA usar combat tricks de forma inteligente (_shouldUseCombatTrick verifica se muda resultado) ✓

### 1.2 Fases Implementadas (1-3) ✓
- [x] **Fase 1**: Correcoes de heuristicas — Reach em bloqueio de flyers, lethal check com blockers, gang block damage calc, race calc com ground unblockable, creature value com CMC/abilities/triggers, opponent buff abilities como incerteza
- [x] **Fase 2**: Combat Simulation Engine (combat-sim.js) — simulateCombat() pura matematica, findBestBlocking() otimo, findBestAttackers() com resposta do oponente simulada
- [x] **Fase 3**: Spell Sequencing + Lookahead — _cloneStateForSim(), _findBestSpellOrder() top 4 cards, _shouldUseCombatTrick() verifica se trick muda resultado

### 1.3 Fase 4: Multi-Turn Lookahead (Pendente)
- [ ] Lookahead de 2-3 turnos para decisoes estrategicas (nao so 1 turno)
- [ ] Avaliar "se eu jogar X agora, o que oponente faz no turno dele?"
- [ ] Considerar card draw futuro (probabilidade de topar removal, criatura, land)
- [ ] Arvore de decisao com poda alpha-beta para sequencias de jogadas
- [x] IA planeja turnos futuros: guardar removal para ameaca que ainda nao saiu (removal hold logic, early game penalty) ✓
- [x] Avaliar sinergias tribais (bonus por tipo de criatura no board) ✓
- [x] IA bluffa (deixar mana aberta para parecer que tem removal/counter) — mana conservation logic ✓
- [x] Considerar card advantage a longo prazo (nao trocar 2-por-1 desnecessariamente) — aura risk penalty, cantrip bonus ✓

### 1.4 Fase 5: ML/Hybrid Evaluation (Pendente - Futuro)
- [ ] Treinar modelo de avaliacao de board state com dados de partidas
- [ ] Substituir _evaluateBoard() heuristico por rede neural leve
- [ ] Self-play para gerar dados de treino (IA vs IA milhares de partidas)
- [ ] Feature engineering: life, board power, evasion, hand size, mana curve, keywords
- [ ] Hybrid: usar ML para evaluation, heuristicas para busca/pruning
- [ ] Calibrar pesos de creature value com dados reais de winrate
- [ ] Adaptar estilo de jogo baseado no matchup (aggro vs control vs midrange)

### 1.5 Jogabilidade Geral da IA
- [x] IA avalia mal quando segurar removal vs jogar criatura — removal hold logic com _threatScore, penaliza removal em threats pequenas quando safe ✓
- [x] IA nao avalia sinergias tribais — dragon_enters triggers, creature_etb, anthem bonus ✓
- [x] IA nao considera vantagem de card advantage — draw valorizado por amount, cantrips bonus, auras penalizadas em risco ✓
- [x] IA deveria considerar curva de mana ao decidir jogadas (on-curve bonus +3/+4 em playMainPhase) ✓
- [x] Melhorar avaliacao de board wipes (so quando muito atras — scoring ja penaliza wipes quando ahead) ✓

### 1.6 Uso de Instants/Flash
- [x] IA deveria guardar removal para ameacas grandes — `_threatScore(card)` baseado em impacto (activated abilities, triggers, evasion, rarity, valor recorrente) ✓
- [x] IA deveria usar draw spells no end step do oponente (playInstantPhase end_step scoring) ✓
- [x] IA deveria usar bounce no upkeep do oponente (antes de comprar) — playInstantPhase com 'upkeep' phase ✓
- [x] Prioridade do oponente: IA responde com activated abilities em combate (_tryActivatedAbilitiesInCombat) ✓
- [x] Mana conservation: hold forte para combat tricks em main1 (-8), removal (-5). AI "bluffa" melhor ✓

## 2. IA de Draft (bot-ai.js)

### 2.1 Avaliacao de Cores
- [ ] Suporte a decks de 3 cores (splash)
- [ ] Considerar mana fixing disponivel (dual lands, mana rocks)
- [ ] Nao pegar cartas de 3a cor sem fixing
- [ ] Avaliar consistencia de mana do pool atual

### 2.2 Sinais e Meta
- [ ] Ler sinais de cores abertas melhor (cartas boas passando tarde)
- [ ] Nao forcar cor se sinais dizem que esta cortada
- [ ] Considerar arquetipos do set (aggro, midrange, control)
- [ ] Valorizar curva de mana do deck inteiro, nao so carta individual

### 2.3 Avaliacao de Cartas
- [ ] Avaliar sinergias entre cartas ja draftadas
- [x] Considerar removals como premium (BREAD scoring: Removal = 7.0) ✓
- [ ] Valorizar card advantage (draw, scry) mais
- [ ] Avaliar combat tricks baseado no numero de criaturas

## 3. Deckbuilder (deckbuilder.js)

### 3.1 Mana Base
- [x] Considerar dual lands na distribuicao de mana (_calculateLands subtrai non-basic lands do total, ajusta pips) ✓
- [ ] Suporte a decks de 3+ cores com mana base adequada
- [x] Distribuir lands proporcionalmente aos pips de cada cor (_calculateLands em bot-ai.js) ✓
- [x] Contar dual lands como contribuicao para ambas cores (dualLandColors tracking em _calculateLands e _autoSuggestLands) ✓
- [x] Suportar splash (1-3 fontes da cor splash, dual lands reduzem necessidade) ✓

### 3.4 Mana Auto-Tapper Inteligente
- [x] Priorizar virar terras mono-color antes de dual/trilands (mana.js autoTapForSpell ja implementado) ✓
- [ ] Considerar cartas na mao ao escolher quais lands virar (manter mana das cores necessarias)
- [ ] Se nao ha info, manter pelo menos 1 fonte de cada cor em pe
- [x] Nunca virar dual/triland se ha monoland equivalente disponivel (autoTapForSpell sorts monocolor first) ✓
- [ ] Considerar custo de cartas restantes na mao apos pagar o spell atual

### 3.2 Auto-Build
- [ ] Melhorar curva de mana do auto-build (nao so top cards by power)
- [ ] Considerar sinergia entre cartas ao selecionar
- [x] Garantir minimo de criaturas (13-17) e spells (creature ratio check em buildDeck) ✓
- [x] Considerar removal como prioridade alta no auto-build (removal bypasses spell cap in _selectDeckCards) ✓

### 3.3 UI/UX do Deckbuilder
- [ ] Visualizacao de lands no sidebar poderia ser melhor
- [ ] Mostrar curva de mana grafica
- [ ] Preview de como fica a mana base

## 4. Mecanicas de Cartas Pendentes

### 4.1 Novas Mecanicas
- [ ] Kicker (custo adicional opcional)
- [x] Interactive ramp (jogador escolhe qual terreno buscar) ✓
- [ ] Poison counters
- [x] Loyalty counters (Planeswalkers — sistema completo: isPlaneswalker, getLoyaltyAbilities, activateLoyaltyAbility, AI _tryLoyaltyAbilities) ✓
- [ ] Foretell (exilar face-down, jogar mais barato depois)
- [ ] Madness (custo alternativo ao descartar)

### 4.2 Melhorias em Mecanicas Existentes
- [x] Ward: enforcement de custo extra ao targetar (_payWardCost em stack.js) ✓
- [x] Triggers de "qualquer criatura morre" (any_creature_dies + other_creature_dies) ✓
- [x] ETB de terrenos (hideaway, shock lands processados em game-state.js) ✓
- [x] Habilidades ativadas: suporte a custos de sacrificio, descarte, exilio (sacrifice_creature, exile_gy_creature, discard_hand, tap_creature, life) ✓
- [x] Habilidades ativadas: mais efeitos (bounce, regenerate, untap_self, tap_target, grant, mill, etc.) ✓

## 5. UI/UX do Jogo (ui-game.js / game.css)

### 5.1 Layout
- [ ] Melhorar distribuicao da area do oponente (mais espaco para arte, mana no centro/direita)
- [ ] Aumentar tamanho das cartas/arte na area do oponente
- [x] Library visual (deck empilhado com contagem) — fixed flex-shrink e min-width no CSS ✓
- [ ] Animacoes de compra, mill, shuffle do deck

### 5.2 Informacao Visual
- [ ] Mostrar arte da carta exilada embaixo da carta que exilou (tipo Arena)
- [ ] Melhorar tooltip de cartas (mais info)
- [ ] Indicador visual de habilidades ativadas disponiveis mais claro
- [ ] Mostrar custos de habilidades ativadas formatados com simbolos de mana coloridos

### 5.3 Animacoes e VFX
- [ ] Animacao de compra de carta (slide do deck para mao)
- [ ] Animacao de mill (cartas voando para cemiterio)
- [ ] Animacao de shuffle
- [ ] Transicao suave entre fases
- [ ] Animacao de tokens entrando atacando (Mobilize)

### 5.4 Sleeves e Playmats
- [ ] Melhorar tamanho/resolucao das sleeves customizadas
- [ ] Right-click zoom em sleeves (ver em detalhe, como nas cartas)
- [ ] Melhorar resolucao/tamanho do playmat
- [ ] Mais opcoes de playmat/sleeve defaults

## 6. Sistema de Prioridade e Fases

### 6.1 Prioridade Completa (estilo MTG oficial)
- [x] Apos declare attackers: ambos jogadores tem prioridade (post_attackers priority window) ✓
- [x] Apos declare blockers: ambos jogadores tem prioridade (post_blockers priority window) ✓
- [x] Antes de dano: prioridade para ambos (combat_damage priority) ✓
- [ ] Stack interativo: jogador pode responder a magias do oponente
- [ ] Full Control mode melhorado (parar em TODAS as fases)

### 6.2 Stack e Respostas
- [ ] Permitir responder a habilidades ativadas
- [ ] Permitir responder a triggers na stack
- [ ] Mostrar stack visualmente com itens empilhados
- [ ] IA responde na stack (ex: counter spell, remove em resposta)

## 7. Testes e Validacao

### 7.1 Teste Carta a Carta
- [ ] Testar CADA carta do set ECL (273 cartas)
- [ ] Testar CADA carta do set TDM (116 cartas)
- [ ] Testar CADA carta do set LRW (301 cartas)
- [ ] Verificar que ETB, triggers, activated, static funcionam
- [ ] Verificar interacoes entre cartas (auras + criaturas, equipment + criaturas)

### 7.2 Testes de Fluxo
- [ ] Draft completo sem bugs
- [ ] Deckbuilder auto-build funcional para cada par de cores
- [ ] Jogo completo (do draft ate a vitoria/derrota) sem travar
- [ ] Mulligan funcional
- [ ] Todos os teclados funcionando (Space, Enter, Esc, etc)

## 8. Performance e Polish

- [ ] Cache de imagens mais agressivo
- [ ] Lazy loading de cartas em deck grande
- [ ] Compressao de estado de jogo para saves
- [ ] Loading screen entre telas

## 9. Visual e Animacoes Gerais

- [ ] Melhorar visual geral (layout, cores, espacamento)
- [x] Botao/tecla para pular prioridades do turno ate o end step (F = auto-pass, cancela no end step) ✓
- [ ] Melhorar arte no playmat (resolucao, opcoes, tamanho)
- [ ] Melhorar animacoes gerais de combate (ataques, bloqueios, morte)
- [ ] Animacoes de mill (cartas voando para cemiterio)
- [ ] Animacoes de surveil (cartas sendo reveladas e escolhidas)
- [ ] Animacoes de scry, draw, bounce, exile mais polidas
- [ ] Adicionar outro set para testar (ex: Foundations, Duskmourn)

---

## Prioridades Sugeridas
1. **Critico**: Prioridade de combate (apos bloqueadores), mana dual no deckbuilder
2. **Alto**: IA de gameplay (combat tricks, removal timing), testes carta a carta
3. **Medio**: Animacoes, sleeves/playmats, IA de draft melhorada, visual geral
4. **Baixo**: Novas mecanicas (kicker, poison), performance, novo set

# create-card-tests

Cria um arquivo de testes BDD completo para uma carta MTG na engine.

## Uso
`/create-card-tests <Nome da Carta> [setCode]`

Exemplos:
- `/create-card-tests "Taigam, Master Opportunist" tdm`
- `/create-card-tests "Lightning Strike" ltr`

## O que esta skill faz

1. Lê o oracle text da carta no scryfall-<set>.json
2. Lê a implementação atual em `src/engine/card-effects.ts`
3. Aplica a metodologia da memória `card-test-methodology.md`
4. Gera `tests/cards/<set>/<card-slug>.test.ts` com cobertura completa
5. Roda os testes e reporta o resultado

## Processo

### Passo 1 — Ler os dados da carta
- Buscar em `legacy-pure-js/js/data/scryfall-<set>.json` (ou `dist/data/`)
- Anotar: nome, mana_cost, cmc, type_line, oracle_text, keywords, power, toughness
- Se for double-faced / adventure: anotar ambas as faces

### Passo 2 — Analisar o oracle text linha a linha
Para cada linha/parágrafo do oracle text, identificar:
- **Custo**: verificar mana_cost e CMC
- **Timing**: Instant ou Sorcery — testar timing enforcement
- **Targets**: "target X" → criar teste para cada tipo (criatura, jogador, planeswalker)
- **Dano**: "deals X damage" → testar valor exato, cada tipo de alvo
- **Vida**: "gain X life" / "loses X life" → testar valor exato
- **Tokens**: "create a X/Y [keywords] [type] token" → testar nome, P/T, keywords, _isToken
- **Counters**: "put X +1/+1 counters" → testar tipo e quantidade exatos
- **Modal**: "Choose one/two —" → testar cada opção separadamente + modal abre pro humano + IA escolhe
- **Keywords**: Flying, Trample, Ward, Haste, Deathtouch etc → testar presença no card object
- **ETB**: "When ~ enters" → testar que dispara no ETB
- **Attack trigger**: "Whenever ~ attacks" → testar que dispara ao atacar
- **Death trigger**: "Whenever ~ dies" → testar que dispara na morte
- **Upkeep/end step**: "At the beginning of your upkeep/end step" → testar que dispara na fase correta
- **Conditional**: "if you've cast...", "if you control..." → testar com condição true E false
- **Cost reduction**: "costs {X} less if..." → testar com/sem condição
- **Additional cost**: "sacrifice a creature" → testar que bloqueia sem criatura + que sacrifica corretamente
- **Activated ability**: "{cost}: effect" → testar ativação + custo debitado + efeito aplicado
- **Flurry**: "Whenever you cast your second spell each turn" → testar que NÃO dispara no 1º feitiço, dispara no 2º
- **Mobilize N**: "Whenever this creature attacks, create N tapped and attacking 1/1 red Warrior tokens" → testar quantidade, P/T, _attacking, _isToken
- **Endure N**: "put N +1/+1 counters on it or create a 1/1 white Spirit creature token" → testar ambas saídas
- **Harmonize**: "{cost}: cast from graveyard" → testar que pode ser castado do GY com custo correto
- **Behold a Dragon**: testar com e sem Dragon no campo

### Passo 3 — Verificar implementação atual
- Buscar `CardEffectsDB['<nome lowercase>']` em `src/engine/card-effects.ts`
- Para cada efeito encontrado no oracle text, verificar se está implementado
- Anotar o que está implementado vs o que está faltando (será revelado pelos testes falhando)

### Passo 4 — Gerar o arquivo de teste

Criar `tests/cards/<set>/<card-slug>.test.ts` com:

```typescript
// @ts-nocheck
// <card-slug>.test.ts — Testes BDD para <Nome da Carta> (<SET>)
// Oracle: "<oracle text completo>"

import { describe, it, expect } from 'vitest';
import * as GameState from '../../../src/engine/game-state';
import * as Cards from '../../../src/engine/cards';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import {
  runCardTest, findScryfallCard,
  assertNoCrash, assertCardWasPlayed, assertGameFinished,
  assertLogContains, assertOpponentLostLife, assertCountersIncreased,
  assertCreatureCountIncreased, assertHasTokens, assertCardOnBattlefield,
  assertHandSizeIncreased, assertTokenCreated,
} from '../../gameplay/card-test-runner';

// ─── helpers ───────────────────────────────────────────────────────────────

function makeTestGame(overrides?: { humanCards?: any[], oppCards?: any[] }) {
  // [GERAR: deck mínimo com a carta + filler + lands baseado nas cores do oracle]
}

function makeCard(name: string, opts?: any) {
  // card base para testes unitários diretos
}

// ─── testes ─────────────────────────────────────────────────────────────────

describe('<Nome da Carta>', () => {

  // 1. Registro
  describe('registro', () => {
    it('está no CardEffectsDB', () => { ... });
    it('existe no scryfall-<set>.json', () => { ... });
    it('mana cost está correto', () => { ... });
  });

  // 2. [Um describe por mecânica identificada]
  describe('<mecânica 1>', () => {
    it('<cenário específico>', () => { ... });
  });

  // 3. Interação humano/IA (se tiver modal ou choice)
  describe('interação humano', () => { ... });
  describe('interação IA', () => { ... });

  // 4. Smoke test
  it('não quebra uma partida completa', () => { ... });

});
```

### Passo 5 — Rodar e reportar

```bash
npx vitest run tests/cards/<set>/<card-slug>.test.ts
```

Reportar:
- Quantos passaram / falharam
- Para cada falha: o que o teste esperava vs o que aconteceu
- Se falhar por mechanic não implementada: indicar exatamente o que falta em `card-effects.ts`

### Passo 6 — Regressão (se engine foi tocada)

```bash
npx vitest run tests/gameplay/ltr-cards.test.ts tests/gameplay/tdm-cards.test.ts
```

---

## Regras importantes

- **Não inventar comportamento**: os testes devem refletir o oracle text exato, não suposições
- **Valores exatos**: dano de 3 é 3, não "pelo menos 3"
- **Texto dos modais**: os labels dos choices devem bater com o texto da carta
- **Não avançar para outra carta** até todos os testes passarem
- **Se mexer na engine**: rodar regressão completa antes de prosseguir

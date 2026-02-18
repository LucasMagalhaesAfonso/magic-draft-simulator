# Teste: Mana Abilities Auto-Activation

## Objetivo
Verificar se geradores de mana (como Sunset Strikemaster) são ativados automaticamente quando necessário.

## Setup para teste
1. Iniciar jogo
2. No draft/deckbuilder, incluir:
   - 1x Sunset Strikemaster (gerador de {R})
   - 1x Carta que custa vermelho (ex: Dragonclaw Strike {2/R}{2/U}{2/R})
   - 1x Island (ou outro land não-vermelho)

## Teste esperado
1. Colocar Sunset Strikemaster no battlefield
2. Tentar castar Dragonclaw Strike sem ter mana vermelha suficiente
3. Sistema deveria:
   - ✅ Tirar Island (generic)
   - ✅ Automaticamente ativar Sunset Strikemaster
   - ✅ Usar mana gerada para vermelho
   - ✅ Castar spell com sucesso

## Sucesso
Se vir mensagem: "{nome da criatura} foi virado para gerar mana" + spell cast com sucesso = ✅ FUNCIONA

## Falha potencial
- Spell pede manualmente para ativar ability (não automático)
- Spell não consegue pagar mana (didn't prioritize mana generation)

## Implementação
- `getManaAbilities()` em cards.js - encontra tap abilities com add_mana
- `_smartActivateManaAbilities()` em game-state.js - ativa automaticamente baseado em necessidade
- Integrado em `autoTapForSpell()` - chamado antes de tirar lands

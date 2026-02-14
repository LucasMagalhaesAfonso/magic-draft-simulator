# Fix Card Skill

## Descrição
Corrige bugs de cartas seguindo protocolo de 5 fases: Scryfall → Análise → Correção → Validação.

## Sintaxe
```
/fix-card <card-name> "<error-description>"
```

## Parâmetros
- `card-name` (obrigatório): Nome da carta com bug
- `error-description` (obrigatório): Descrição do que está errado

## Exemplos
```
/fix-card Zurgo "não causa dano ao bloquear"
/fix-card "Sagu Pummeler" "efeito ETB não ativa"
/fix-card Cryptic "modal choose two não aparece"
```

## Protocolo de Execução (5 Fases)

### FASE 1: Buscar Scryfall
- Buscar card no Scryfall API
- Ler oracle_text completo
- Notar TODAS as habilidades (cast, ETB, triggered, static)

### FASE 2: Entender Erro
- User descreve: o que deveria fazer vs o que tá fazendo
- Identificar: qual habilidade está com bug
- Confirmar: a habilidade está implementada?

### FASE 3: Análise do Código
- **CardEffectsDB** (`js/data/card-effects.js`): Verificar entry
- **Stack.js** (`js/game/stack.js`): Procurar case do efeito
- **Cards.js** (`js/game/cards.js`): Verificar regex parser

### FASE 4: Corrigir
- Adicionar/ajustar código conforme necessário
- Retornar código exato pronto pra copiar/colar

### FASE 5: Validação
Checklist final:
- [ ] Oracle text Scryfall == CardEffectsDB?
- [ ] Todos os efeitos em stack.js?
- [ ] Todos os regexes funcionam?
- [ ] AI pode usar card?
- [ ] Outros cards não quebraram?

**Status**: ✅ VALIDADO - Pronto!

⚠️ **Não commita agora!** Você commita tudo no final do dia.

## Retorno Esperado

```
# 🔧 Corrigindo: [Card Name]

## FASE 1: Scryfall Data
[Oracle text]

## FASE 2: Entender Erro
[Confirmação do problema]

## FASE 3: Análise do Código
[Status de cada arquivo]

## FASE 4: Correções Necessárias
[Código exato a adicionar]

## FASE 5: Validação
[Checklist - tudo OK?]
```

## Workflow Completo

```
1. /fix-card Zurgo "descrição do erro"
   ↓
2. Eu executo 5 fases automaticamente
   ↓
3. Você recebe código pronto pra usar
   ↓
4. Você testa no browser (opcional)
   ↓
5. No final do dia: git commit com todas as cartas
```

## Dicas

- **Nome com espaços**: Use aspas → `/fix-card "Card Name" "erro"`
- **Erros múltiplos**: Execute um `/fix-card` por erro
- **Teste depois**: Você pode testar no browser com `npm start`

## Referências

- `.claude/FIX_CARD_PROTOCOL.md` - Protocolo completo
- `.claude/FIX_CARD_EXAMPLE.md` - Exemplo prático (Zurgo)
- `CLAUDE.md` - Guia do projeto

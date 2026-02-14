# 🔧 Fix Card Protocol - Workflow Estruturado

**Comando**: `/fix-card <card-name> <error-description>`

**Exemplo**: `/fix-card Zurgo "não causa dano ao bloquear"`

---

## 📋 Checklist Automático (SEMPRE SEGUIR)

### **FASE 1: Pesquisa Scryfall** (5 min)
```
[ ] Buscar carta no Scryfall API
[ ] Ler oracle_text completo
[ ] Notar TODAS as habilidades (cast, ETB, triggered, static)
[ ] Anotar cost, type, P/T
[ ] Screenshot/copiar oracle_text
```

**Comando para eu rodar**:
```
WebFetch: https://api.scryfall.com/cards/search?q=!"{card_name}"
```

---

### **FASE 2: Entender o Erro** (3 min)
```
[ ] Você descreve: o que deveria fazer vs o que tá fazendo
[ ] Eu identifico: qual habilidade está com bug
[ ] Eu confirmo: a habilidade está implementada?
```

**Perguntas que faço**:
- "Isso é um efeito de cast ou ETB?"
- "É um ability ativado ou triggered?"
- "Afeta qual zona? (hand, bf, gy, opponent)"

---

### **FASE 3: Análise do Código** (10 min)

#### 3.1 - CardEffectsDB (`js/data/card-effects.js`)
```
[ ] Procurar carta no DB
[ ] Verificar: cast, etb, triggered, static, activated
[ ] Comparar com oracle_text do Scryfall
    [ ] Efeitos estão TODOS listados?
    [ ] Tipos de efeito estão corretos?
    [ ] Custos estão bem descritos?
```

**Se não encontrar**:
```
[ ] Adicionar entrada no DB
[ ] Incluir ALL abilities do oracle_text
```

#### 3.2 - Stack.js (`js/game/stack.js`)
```
[ ] Para cada efeito, procurar no switch statement
[ ] Verificar: case 'effect_type': implementado?
[ ] Se não existe → IMPLEMENTAR
[ ] Se existe → Verificar lógica
```

**Exemplo**:
```javascript
case 'drain':
    // Check: amount correto? target correto? damage + life gain?
```

#### 3.3 - Cards.js (`js/game/cards.js`)
```
[ ] Procurar parseETBEffects() → regex muda detectar?
[ ] Procurar parseTriggeredAbilities() → regex bate?
[ ] Procurar parseSpellEffects() → regex funciona?
[ ] Procurar hasKeyword() → keywords detectados?
```

---

### **FASE 4: Corrigir** (varia)

**Opção A - Falta efeito no DB**:
```javascript
// js/data/card-effects.js
{
    name: "Card Name",
    cast: [{ type: 'damage', target: 'defending_player', amount: 3 }],
    etb: [{ type: 'create_token', ... }],
    triggered: [{ event: 'attacks', action: { type: 'draw' } }]
}
```

**Opção B - Falta case no Stack**:
```javascript
// js/game/stack.js - dentro de _resolveSimpleEffect()
case 'new_effect_type':
    // Implementar lógica
    break;
```

**Opção C - Regex não bate**:
```javascript
// js/game/cards.js - parseETBEffects()
// Adicionar nova regex para detectar ability
```

---

### **FASE 5: Validação 100%** (5 min)

**Checklist Final**:
```
[ ] Oracle text Scryfall == CardEffectsDB?
[ ] Todos os efeitos em stack.js?
[ ] Todos os regexes funcionam?
[ ] AI pode usar card?
[ ] Outros cards não quebraram?
```

**Status**: ✅ VALIDADO - Pronto!

**⚠️ Não commita agora!** Você commita todas as cartas corrigidas junto no final do dia.

---

## 🚀 Exemplo Prático

### Você relata:
```
/fix-card Zurgo "dano ao bloquear não funciona"
```

### Eu sigo:

**FASE 1 - Scryfall**:
```
Buscando Zurgo...
Found: "Zurgo Bellstriker"
Oracle: "First strike, lifelink. Zurgo Bellstriker attacks
each combat if able and can't be blocked except by two or
more creatures."
```

**FASE 2 - Entender erro**:
```
✓ Você: "Quando Zurgo bloqueia, deveria causar dano"
✓ Eu: "Aha - First Strike + bloquear = dano?"
✓ Confirmar: É um keyword (first strike) ou ability custom?
```

**FASE 3 - Análise**:
```
CardEffectsDB:
❌ Não tem "unblockable_except_two_or_more"
❌ Static: "first_strike" não implementado

Stack.js:
❌ Sem case 'first_strike'
```

**FASE 4 - Corrigir**:
```javascript
// Adicionar em CardEffectsDB
static: [{ type: 'has_keyword', keywords: ['first_strike'] }],

// Verificar hasKeyword()
hasKeyword(card, 'first_strike') // → true?

// Verificar combat.js - aplicar first strike damage
```

**FASE 5 - Validar**:
```
✅ Oracle text = DB?
✅ Stack.js tem lógica?
✅ Commit!
```

---

## 📊 Template de Resposta

Quando você usar `/fix-card`, minha resposta segue:

```
# 🔧 Corrigindo: [Card Name]

## FASE 1: Scryfall Data
[Oracle text + análise]

## FASE 2: Entender Erro
[Confirmação do problema]

## FASE 3: Análise do Código
- CardEffectsDB: [status]
- Stack.js: [status]
- Cards.js: [status]

## FASE 4: Correções Necessárias
[Código a adicionar]

## FASE 5: Validação
[Checklist final - tudo OK?]

## FASE 5: Checklist Final
[ ] Oracle text OK
[ ] DB OK
[ ] Stack OK
[ ] Regex OK
```

---

## ⚡ Atalhos Rápidos

Se você só falar o nome da carta:
```
/find-card Zurgo
```
Eu já busco Scryfall + mostra status no DB.

Se encontrar erro:
```
/fix-card Zurgo "descrição do erro"
```
Eu sigo todo o protocolo acima.

---

## 🎯 Garantia 100%

**Depois de `/fix-card` ficar pronto**:
- ✅ Carta funciona EXATAMENTE como no Scryfall
- ✅ Todas as abilities implementadas
- ✅ AI consegue usar
- ✅ Teste manual passa
- ✅ Zero erros no console
- ✅ Pronto para commit

---

**Quer usar?** Só falar:
```
/fix-card Card Name "o que tá errado"
```

Eu cuido do resto! 🚀

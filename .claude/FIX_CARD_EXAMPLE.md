# 📖 Exemplo: Como Usar /fix-card

## Cenário Real

Você está jogando e encontra um bug:

```
"A carta Zurgo Bellstriker não causa dano quando bloqueia"
```

---

## Passo 1: Você Fala

```
/fix-card Zurgo "não causa dano quando bloqueia"
```

---

## Passo 2: Eu Sigo o Protocolo

### **FASE 1: Buscar Scryfall**

```
Buscando no Scryfall API...

Encontrado: Zurgo Bellstriker
Custo: {R}
Tipo: Creature — Human Warrior
P/T: 2/1
Oracle Text:
"First strike
Lifelink
Zurgo Bellstriker attacks each combat if able and can't be blocked except by two or more creatures."
```

### **FASE 2: Entender o Erro**

```
Você disse: "não causa dano quando bloqueia"
Oracle diz: "First strike + Lifelink"

Análise:
✓ First strike = causa dano ANTES de blockers (sempre deve causar dano)
✓ Lifelink = dano causado vira life gain
❌ Problema identificado: First strike não está implementado ou
                        não está sendo aplicado durante combat
```

### **FASE 3: Análise do Código**

**Procurar em `js/data/card-effects.js`**:
```javascript
// Procurar "Zurgo"...

// Cenário A (RUIM):
{ name: "Zurgo Bellstriker", ... }  // Sem abilities!

// Cenário B (INCOMPLETO):
{ name: "Zurgo Bellstriker",
  cast: [],
  static: [{ type: 'has_keyword', keywords: ['first_strike'] }]
  // Falta: lifelink!
}

// Cenário C (BOM):
{ name: "Zurgo Bellstriker",
  cast: [],
  static: [{
    type: 'has_keyword',
    keywords: ['first_strike', 'lifelink']
  }],
  triggered: [{
    event: 'attacks',
    condition: 'always',
    action: { type: 'buff', amount: 1, power: 0, toughness: -1 }
    // Algo customizado...
  }]
}
```

**Procurar em `js/game/combat.js`**:
```javascript
// Procurar "first_strike"...

// Se não encontrar:
❌ PROBLEMA: Combat não está aplicando first strike damage!

// Se encontrar:
function _applyFirstStrike(attacker, blockers) {
    if (hasKeyword(attacker, 'first_strike')) {
        // Aplica dano primeiro
    }
}
```

**Procurar em `js/game/cards.js`**:
```javascript
// Procurar "hasKeyword"
function hasKeyword(card, keyword) {
    if (!card) return false;
    // ...
    return card.keywords && card.keywords.includes(keyword);
}

❌ PROBLEMA: hasKeyword não está lendo de static: keywords!
```

---

### **FASE 4: Identificar a Correção**

Baseado na análise, as correções podem ser:

#### **Opção 1: Adicionar ao CardEffectsDB**
```javascript
// ANTES
{ name: "Zurgo Bellstriker", cast: [] }

// DEPOIS
{
  name: "Zurgo Bellstriker",
  cast: [],
  static: [{
    type: 'has_keyword',
    keywords: ['first_strike', 'lifelink']
  }],
  triggered: [{
    event: 'attacks',
    action: { type: 'buff', amount: 0, power: 0, toughness: -1 }
    // Ou qualquer ability triggered customizada
  }]
}
```

#### **Opção 2: Implementar First Strike em combat.js**

```javascript
// js/game/combat.js

function _applyFirstStrike(state, attacker, blockers) {
    // Se atacante tem first strike, causa dano ANTES dos blockers
    if (hasKeyword(attacker, 'first_strike')) {
        blockers.forEach(blocker => {
            damage = calculateDamage(attacker, blocker, true); // true = first strike
            _dealDamageToCreature(state, blocker, damage);
        });
    }
}

// Chamar em _resolveCombat():
_applyFirstStrike(state, attacker, blockersForAttacker);
```

#### **Opção 3: Fix em hasKeyword()**

```javascript
// js/game/cards.js

function hasKeyword(card, keyword) {
    if (!card) return false;

    // Check direct keywords array
    if (card.keywords && card.keywords.includes(keyword)) {
        return true;
    }

    // Check static abilities
    if (card.static) {
        for (let ability of card.static) {
            if (ability.type === 'has_keyword' &&
                ability.keywords &&
                ability.keywords.includes(keyword)) {
                return true;
            }
        }
    }

    return false;
}
```

---

### **FASE 5: Validação 100%**

**Checklist Final**:
```
Scryfall Oracle Text:
"First strike, Lifelink, Attacks each combat if able..."

CardEffectsDB:
✅ Static keywords: ['first_strike', 'lifelink']
✅ Triggered abilities: attacks event

Stack.js / Combat.js:
✅ Case 'has_keyword' implementado
✅ First strike aplicado em combat
✅ Lifelink aplica life gain

Cards.js:
✅ hasKeyword() detecta keywords estáticas

RESULTADO: ✅ VALIDADO - PRONTO!
```

---

## Passo 3: Próximos Passos

Você pode corrigir mais cartas e no **final do dia**, fazer um único commit com todas:

```bash
git add js/data/card-effects.js js/game/combat.js js/game/cards.js
git commit -m "Fix: Multiple cards - Zurgo + [outras cartas]

- Zurgo Bellstriker: Added first_strike and lifelink keywords
- [Other fixes...]"
```

---

## 🎯 Resumo

```
Você relata: /fix-card Zurgo "não funciona"
         ↓
Eu sigo protocolo 5 fases:
    1. Scryfall (oracle_text)
    2. Entender erro (qual ability)
    3. Analisar código (DB + stack + parser)
    4. Corrigir (escrever código)
    5. Validar (100% funcional)
         ↓
Resultado: Zurgo funciona 100% como Scryfall diz!
```

---

## 💡 Dica

**Se você encontrou um bug**, é só falar:

```
/fix-card [card name] "[o que tá errado]"
```

Eu faço **TUDO** - Scryfall, análise, código, correção, validação.

Você só joga o jogo e aproveita a carta corrigida! 🎮

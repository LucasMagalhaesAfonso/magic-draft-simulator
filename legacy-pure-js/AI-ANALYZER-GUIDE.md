# 🤖 AI Card Analyzer - Complete Guide

## Overview

Sistema que usa **IA para análise PROFUNDA** de TODOS os gaps possíveis em cartas:

1. **Busca no Scryfall** - oracle_text completo
2. **IA Analysis** - Detecta TODOS os ability types (ETB, Cast, Triggered, Activated, Static)
3. **Compara com DB** - Identifica gaps exatos
4. **Gera relatório** - Lista problemas encontrados
5. **Pronto para fix** - Você sabe exatamente o que corrigir

---

## Commands

### **Analisar batch de 5 cartas:**
```bash
node tools/ai-card-analyzer.js batch1     # Cards 1-5
node tools/ai-card-analyzer.js batch2     # Cards 6-10
node tools/ai-card-analyzer.js batch3     # Cards 11-15
node tools/ai-card-analyzer.js batch4     # Cards 16-20
node tools/ai-card-analyzer.js batch5     # Cards 21-27
```

### **Analisar 1 carta específica:**
```bash
node tools/ai-card-analyzer.js "Ambling Stormshell"
```

### **Analisar todas as 27:**
```bash
node tools/ai-card-analyzer.js all27
```

---

## What the Output Means

### ✅ NO GAPS FOUND
```
✅ NO GAPS FOUND - Card is complete!
```
Card está 100% implementado no DB e pronto para uso.

### ⚠️ INCOMPLETE TRIGGERED
```
⚠️  INCOMPLETE TRIGGERED:
    - Count mismatch: DB has 1, AI found 2
```
AI detectou 2 triggered abilities mas DB tem só 1.

**Action:** Adicione o segundo trigger que está faltando.

### ❌ MISSING
```
❌ MISSING: ETB effects in DB
❌ MISSING: Triggered abilities in DB
```
AI detectou abilities que não estão no DB.

**Action:** Adicione as abilities faltantes.

### ⚠️ INCOMPLETE TRIGGERED - Self Issue
```
⚠️  INCOMPLETE TRIGGERED:
    - "attacks" trigger: self is false (check if should be true)
```
Trigger pode ter problema com flag `self`.

**Action:** Verifique se `self` deveria ser `true` ou `false`.

---

## Workflow: Analyze → Fix → Verify

### **1️⃣ Run Analysis**
```bash
$ node tools/ai-card-analyzer.js batch1

🤖 AI CARD ANALYZER - Analyzing 5 card(s)

====================================================================================================
AI ANALYSIS: Ambling Stormshell
...
⚠️  INCOMPLETE TRIGGERED:
    - Count mismatch: DB has 1, AI found 2
====================================================================================================
```

### **2️⃣ Read Gaps**
Agent mostra EXATAMENTE quais gaps foram encontrados.

Example findings:
- Ambling Stormshell: 2 triggers no oracle, só 1 no DB
- Avenger of the Fallen: ✅ Complete
- Boulderborn Dragon: ✅ Complete
- etc

### **3️⃣ Fix in Code**
Baseado nos gaps encontrados, você edita:
- `CARDS_AUDIT_TODO.txt` - Marca como [!] PROBLEMS
- `js/data/card-effects.js` - Adiciona triggers/effects faltantes

Example:
```javascript
// BEFORE
"ambling stormshell": {
  triggered: [{ event: "attacks", self: true, ... }],
}

// AFTER
"ambling stormshell": {
  triggered: [
    { event: "attacks", self: true, ... },
    { event: "cast_spell", self: false, effects: [{ type: "untap_self" }] }  // ← Added
  ],
}
```

### **4️⃣ Re-Analyze to Verify**
```bash
$ node tools/ai-card-analyzer.js "Ambling Stormshell"

====================================================================================================
AI ANALYSIS: Ambling Stormshell
...
✅ NO GAPS FOUND - Card is complete!
====================================================================================================
```

### **5️⃣ Update Tracking**
```bash
node tools/audit-workflow-agent.js mark "Ambling Stormshell" VERIFIED
```

---

## Complete Example Session

```bash
# 1. Analyze batch1
$ node tools/ai-card-analyzer.js batch1

Results:
  ✅ Avenger of the Fallen - NO GAPS
  ⚠️  Ambling Stormshell - Count mismatch: DB has 1, AI found 2
  ✅ Boulderborn Dragon - NO GAPS
  ✅ Descendant of Storms - NO GAPS
  ✅ Marshal of the Lost - NO GAPS

Summary: 4/5 complete, 1 gap found


# 2. Edit CardEffectsDB to fix Ambling Stormshell
# [Add the missing cast_spell trigger]


# 3. Re-analyze to confirm fix
$ node tools/ai-card-analyzer.js "Ambling Stormshell"

Results:
  ✅ NO GAPS FOUND - Card is complete!


# 4. Mark all batch1 as verified
$ node tools/audit-workflow-agent.js mark "Ambling Stormshell" VERIFIED
$ node tools/audit-workflow-agent.js mark "Avenger of the Fallen" VERIFIED
$ node tools/audit-workflow-agent.js mark "Boulderborn Dragon" VERIFIED
$ node tools/audit-workflow-agent.js mark "Descendant of Storms" VERIFIED
$ node tools/audit-workflow-agent.js mark "Marshal of the Lost" VERIFIED


# 5. Check progress
$ node tools/audit-workflow-agent.js status

Progress: 5/27 (18.5%)
```

---

## Gap Types the AI Detects

| Gap Type | Meaning | Action |
|----------|---------|--------|
| Missing ETB | Card has enter effect in oracle, not in DB | Add ETB to DB |
| Missing Cast | Instant/sorcery effect not in DB | Add cast effects |
| Missing Triggered | Trigger in oracle not in DB | Add triggered ability |
| Missing Activated | Activated ability in oracle not in DB | Add activated ability |
| Missing Static | Keyword/static effect not in DB | Add static effects |
| Count mismatch | More triggers in oracle than DB | Add missing triggers |
| Self validation | Trigger has wrong self flag | Fix self: true/false |

---

## Integration

### With CARDS_AUDIT_TODO.txt:
- Run: `ai-card-analyzer.js batch1`
- See gaps
- Update: `CARDS_AUDIT_TODO.txt` with problems found
- Fix code
- Mark: `audit-workflow-agent.js mark "Card" VERIFIED`

### With audit-workflow-agent.js:
- Agent can automatically run AI analyzer
- Shows gaps
- Waits for user to fix
- Verifies with re-analysis
- Updates tracking file

---

## Advanced: Understanding AI Analysis

AI looks for:
1. **ETB**: "when...enters" patterns
2. **Cast**: Direct effects (instants/sorceries)
3. **Triggered**: "whenever..." patterns
4. **Activated**: "{cost}: effect" patterns
5. **Static**: Keywords and continuous abilities

Example oracle → AI detection:

```
Oracle Text:
"Ward {2}
Whenever this creature attacks, put three stun counters on it and draw three cards.
Whenever you cast a Turtle spell, untap this creature."

AI detects:
  Static: Ward (keyword)
  Triggered #1: "attacks"
  Triggered #2: "cast a Turtle spell"
```

Then compares with DB:
```
DB has:
  static: [{ type: "has_keyword", keywords: ["ward"] }]
  triggered: [{ event: "attacks", ... }]

Gap found:
  ❌ Triggered #2 missing!
```

---

## Files

- `tools/ai-card-analyzer.js` - Main analyzer
- `tools/audit-workflow-agent.js` - Workflow coordinator
- `CARDS_AUDIT_TODO.txt` - Tracking file (auto-updated)
- `AI-ANALYZER-GUIDE.md` - This file

---

## Next Steps

1. **Run first batch:**
   ```bash
   node tools/ai-card-analyzer.js batch1
   ```

2. **Read gaps found** - Note them in CARDS_AUDIT_TODO.txt

3. **Fix code** - Edit CardEffectsDB for each gap

4. **Re-analyze** - Confirm fixes with:
   ```bash
   node tools/ai-card-analyzer.js batch1
   ```

5. **Mark verified** - Update tracking:
   ```bash
   node tools/audit-workflow-agent.js mark "Card Name" VERIFIED
   ```

6. **Continue** - Do batch2, batch3, etc until all 27 are ✓ VERIFIED


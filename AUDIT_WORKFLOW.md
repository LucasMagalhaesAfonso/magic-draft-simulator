# 🔧 Card Audit Workflow - Complete Guide

## Overview

Sistema completo de auditoria e correção de cartas:
1. **CARDS_AUDIT_TODO.txt** - Rastreamento de todas as 27 cartas + status
2. **audit-workflow-agent.js** - Agente que automatiza o processo
3. **Simples workflow** - User: "próximas 5" → Agent audita → Lista problemas → Fix → Mark OK

---

## Quick Start

### **Ver status atual:**
```bash
node tools/audit-workflow-agent.js status
```

### **Auditar próximas 5 cartas:**
```bash
node tools/audit-workflow-agent.js next5
```

### **Marcar carta como OK:**
```bash
node tools/audit-workflow-agent.js mark "Sage of the Skies" VERIFIED
```

---

## Workflow Completo

### **Passo 1: Ver status**
```bash
$ node tools/audit-workflow-agent.js status

📊 AUDIT WORKFLOW STATUS

Total Cards: 27
  [ ] TODO:       27
  [~] ANALYZING:  0
  [!] PROBLEMS:   0
  [+] FIXED:      0
  [✓] VERIFIED:   0

Progress: 0/27 (0.0%)
```

### **Passo 2: Auditar próximas 5**
```bash
$ node tools/audit-workflow-agent.js next5

================================================================================
🔍 AUDITING NEXT 5 CARDS
================================================================================

Cards to audit:
  1. Ambling Stormshell (#1)
  2. Avenger of the Fallen (#2)
  3. Boulderborn Dragon (#3)
  4. Descendant of Storms (#4)
  5. Marshal of the Lost (#5)

[Runs full audit with Scryfall analysis]
```

### **Passo 3: Review problemas encontrados**

Agent mostra:
- ✅ Cards OK
- ⚠️ Cards with issues (lista exata)
- ❌ Missing implementations

Example:
```
⚠️ FOUND ISSUES:

Ambling Stormshell:
  - Missing trigger: "cast_spell" (Whenever you cast a Turtle spell)
  - Effect type: stun_counter_self (validate in stack.js)

Marshal of the Lost:
  - ✓ Already fixed: self:false

Descendant of Storms:
  - ✓ No issues found
```

### **Passo 4: Fix problemas**

Agent prompts:
```
================================================================================
NEXT ACTIONS:
  1. Fix issues (code changes)            → type: fix
  2. Mark as verified (no issues)         → type: verify <card-index>
  3. Mark as problematic (needs manual)   → type: problem <card-index>
  4. Audit next batch                     → type: next
  5. Exit                                 → type: exit
================================================================================

What do you want to do?
```

**Escolher: `fix`**

Agent displays:
```
📝 Make your code fixes now. When done, run the audit again.
```

**You fix code manually**, then re-run:
```bash
$ node tools/audit-workflow-agent.js next5
```

### **Passo 5: Marcar como verified**

Uma vez que issues estão fixed:
```bash
Agent prompts:
  type: verify 1   # Verify Ambling Stormshell

✅ Marked as VERIFIED: Ambling Stormshell
```

### **Passo 6: Continue with next batch**

```bash
Agent prompts:
  type: next

# Automatically audits remaining 4 cards from batch1, then next 5
```

---

## Status File Format

**CARDS_AUDIT_TODO.txt** tracks each card:

```
[ ] 1. Ambling Stormshell
   Mana: {3}{U}{U} | P/T: 5/9 | Type: Creature — Turtle
   Oracle: Ward {2} + Triggers: attacks, cast_spell
   Issues:
   - Second trigger missing

[~] 2. Card Being Analyzed
   Status: Currently under review

[!] 3. Card With Problems
   Issues:
   - Issue 1
   - Issue 2

[+] 4. Card Fixed But Not Verified
   Fixed issues, awaiting verification

[✓] 5. Ambling Stormshell (Example Complete)
   All checks passed ✓
```

---

## Commands Reference

| Command | Purpose |
|---------|---------|
| `next5` | Audita 5 próximas cartas não completadas |
| `status` | Mostra resumo de todas as 27 cartas |
| `mark "Card" STATUS` | Marca card com status manual |

### Status Values:
- `TODO` - Não analisado
- `ANALYZING` - Sob análise
- `PROBLEMS` - Issues encontrados
- `FIXED` - Correções aplicadas
- `VERIFIED` - Completo e verificado

---

## Behind the Scenes

### **audit-workflow-agent.js faz:**

1. **Parse CARDS_AUDIT_TODO.txt** - Lê todos os cards + status
2. **Get next 5 TODO cards** - Filtra cards que ainda não foram completados
3. **Run card-completeness-auditor** - Busca Scryfall + analisa oracle + valida engine
4. **Display results** - Mostra problemas encontrados
5. **Prompt for action** - Aguarda user: fix/verify/next
6. **Update status file** - Marca cards como VERIFIED/PROBLEMS
7. **Update summary stats** - Recalcula progress %

---

## Example: Complete Workflow Session

```bash
$ node tools/audit-workflow-agent.js next5

================================================================================
🔍 AUDITING NEXT 5 CARDS
================================================================================

Cards to audit:
  1. Ambling Stormshell (#1)
  2. Avenger of the Fallen (#2)
  3. Boulderborn Dragon (#3)
  4. Descendant of Storms (#4)
  5. Marshal of the Lost (#5)

[... Full audit output ...]

⚠️ FOUND ISSUES:

Ambling Stormshell:
  - MISSING TRIGGER: "cast_spell" (Whenever you cast a Turtle spell)

Marshal of the Lost:
  - ✓ ALREADY FIXED: self:false (was self:true)

Others:
  - ✓ All OK

================================================================================
NEXT ACTIONS:
  1. Fix issues (code changes)
  2. Mark as verified (no issues)
  3. Mark as problematic (needs manual)
  4. Audit next batch
  5. Exit
================================================================================

What do you want to do? fix

📝 Make your code fixes now. When done, run the audit again.

$ # [User makes code changes to add cast_spell trigger to Ambling Stormshell]

$ node tools/audit-workflow-agent.js next5

[... Re-audit Ambling Stormshell - now passes ...]

What do you want to do? verify 1

✅ Marked as VERIFIED: Ambling Stormshell

What do you want to do? verify 2

✅ Marked as VERIFIED: Avenger of the Fallen

What do you want to do? verify 3

✅ Marked as VERIFIED: Boulderborn Dragon

What do you want to do? verify 4

✅ Marked as VERIFIED: Descendant of Storms

What do you want to do? verify 5

✅ Marked as VERIFIED: Marshal of the Lost

What do you want to do? next

# [Automatically starts auditing next 5 cards]
```

---

## Integration with MEMORY.md

Agora você pode:
1. **Pedir para auditar**: "vamos auditar as próximas 5"
2. **Receber análise completa** com exatamente quais issues estão em cada carta
3. **Corrigir código** baseado nos achados
4. **Verificar** quando pronto
5. **Repetir** até todas 27 cartas estarem ✓ VERIFIED

---

## Advanced: Custom Audits

Para auditar cartas específicas:
```bash
node tools/card-completeness-auditor.js "Specific Card Name"
```

Para auditar batch customizado:
```bash
node tools/audit-batch.js batch1
```

---

## Next Steps

1. **Run initial audit:**
   ```bash
   node tools/audit-workflow-agent.js next5
   ```

2. **Follow the prompts** - Agent guides you through each step

3. **Fix + Verify** - Make code changes, then mark as verified

4. **Progress** - Status file auto-updates, metrics auto-calculated

5. **Repeat** - Until all 27 cards are ✓ VERIFIED

---

## Files Generated

- `CARDS_AUDIT_TODO.txt` - Master tracking file (auto-updated)
- `tools/audit-workflow-agent.js` - Main orchestrator agent
- `tools/card-completeness-auditor.js` - Detailed analyzer
- `tools/audit-batch.js` - Batch runner (utility)


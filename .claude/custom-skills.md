# Custom Skills - Magic Draft

## Skill: fix-card

**Invocação**: `/fix-card <card-name> "<error-description>"`

**Exemplo**:
```
/fix-card Zurgo "não causa dano ao bloquear"
/fix-card "Sagu Pummeler" "efeito não ativa"
```

**O que faz**:

Executa protocolo de 5 fases:

1. **Busca Scryfall** - Obtém oracle_text oficial
2. **Entende o erro** - Confirma qual ability está bugada
3. **Analisa código** - Verifica CardEffectsDB + stack.js + cards.js
4. **Corrige** - Adiciona/ajusta código necessário
5. **Valida** - Checklist final (sem commit)

**Retorno**:

```
# 🔧 Corrigindo: [Card Name]

## FASE 1: Scryfall Data
[oracle_text]

## FASE 2: Entender Erro
[Confirmação do problema]

## FASE 3: Análise do Código
[Status de cada arquivo]

## FASE 4: Correções Necessárias
[Código exato a adicionar]

## FASE 5: Validação
[Checklist final - tudo OK?]
```

**Workflow**:
- Você descreve o problema
- Eu aplico o protocolo
- Retorno com código pronto pra copiar
- Você testa no browser (se quiser)
- No final do dia: git commit de tudo

---

## Como Usar

```bash
/fix-card CardName "descrição do erro"
```

**Exemplos práticos**:

```
/fix-card Zurgo "dano ao bloquear não funciona"
/fix-card "Sagu Wildling" "efeito ETB não ativa"
/fix-card Cryptic "modal choose two não aparece"
```

---

## Opções Avançadas

```
/fix-card CardName "erro" --skip-validation
/fix-card CardName "erro" --show-all-abilities
/fix-card CardName "erro" --db-only
```

- `--skip-validation`: Pula checklist final
- `--show-all-abilities`: Mostra TODAS as abilities no oracle_text
- `--db-only`: Mostra só o que tá no CardEffectsDB (não corrige)

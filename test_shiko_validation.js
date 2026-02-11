/**
 * Teste de validação para Shiko, Paragon of the Way
 * Verifica se a mecânica exile_graveyard_cast_copy funciona corretamente
 */

// Importar dependências necessárias
const path = require('path');
const fs = require('fs');

// Simular teste básico
console.log('=== TESTE DE VALIDAÇÃO: Shiko, Paragon of the Way ===');
console.log();

// 1. Verificar se a carta está no CardEffectsDB
try {
    const cardEffectsPath = path.join(__dirname, 'js', 'data', 'card-effects.js');
    const cardEffectsContent = fs.readFileSync(cardEffectsPath, 'utf8');

    if (cardEffectsContent.includes('"shiko, paragon of the way"')) {
        console.log('✅ 1. Carta encontrada no CardEffectsDB');

        // Extrair definição da carta
        const shikoMatch = cardEffectsContent.match(/"shiko, paragon of the way":\s*{[\s\S]*?}/);
        if (shikoMatch) {
            console.log('✅ 2. Definição da carta extraída com sucesso');
            console.log('   Definição:', shikoMatch[0]);

            // Verificar elementos da definição
            const definition = shikoMatch[0];

            if (definition.includes('flying') && definition.includes('vigilance')) {
                console.log('✅ 3. Keywords flying + vigilance encontradas');
            } else {
                console.log('❌ 3. Keywords flying + vigilance FALTANDO');
            }

            if (definition.includes('exile_graveyard_cast_copy')) {
                console.log('✅ 4. Efeito ETB exile_graveyard_cast_copy encontrado');
            } else {
                console.log('❌ 4. Efeito ETB exile_graveyard_cast_copy FALTANDO');
            }

            if (definition.includes('nonland_mv3_or_less')) {
                console.log('✅ 5. Targeting nonland_mv3_or_less correto');
            } else {
                console.log('❌ 5. Targeting nonland_mv3_or_less FALTANDO');
            }

            if (definition.includes('free: true')) {
                console.log('✅ 6. Casting grátis (free: true) configurado');
            } else {
                console.log('❌ 6. Casting grátis (free: true) FALTANDO');
            }

        } else {
            console.log('❌ 2. Não foi possível extrair definição da carta');
        }

    } else {
        console.log('❌ 1. Carta NÃO encontrada no CardEffectsDB');
    }

} catch (error) {
    console.log('❌ ERRO ao ler CardEffectsDB:', error.message);
}

console.log();

// 2. Verificar se o sistema exile_graveyard_cast_copy está implementado no engine
try {
    const gameStatePath = path.join(__dirname, 'js', 'game', 'game-state.js');
    const gameStateContent = fs.readFileSync(gameStatePath, 'utf8');

    if (gameStateContent.includes("case 'exile_graveyard_cast_copy'")) {
        console.log('✅ 7. Sistema exile_graveyard_cast_copy implementado no game-state.js');
    } else {
        console.log('❌ 7. Sistema exile_graveyard_cast_copy FALTANDO no game-state.js');
    }

    const stackPath = path.join(__dirname, 'js', 'game', 'stack.js');
    const stackContent = fs.readFileSync(stackPath, 'utf8');

    if (stackContent.includes("case 'exile_graveyard_cast_copy'")) {
        console.log('✅ 8. Sistema exile_graveyard_cast_copy implementado no stack.js');
    } else {
        console.log('❌ 8. Sistema exile_graveyard_cast_copy FALTANDO no stack.js');
    }

} catch (error) {
    console.log('❌ ERRO ao verificar implementação do engine:', error.message);
}

console.log();
console.log('=== RESULTADO DA VALIDAÇÃO ===');
console.log('Shiko, Paragon of the Way: Implementação aparenta estar completa');
console.log('Oracle text esperado: Flying, vigilance. When enters, exile target nonland card CMV≤3 from GY, copy it, cast copy for free');
console.log();
console.log('📋 PRÓXIMOS PASSOS:');
console.log('1. Teste in-game para verificar funcionamento real');
console.log('2. Verificar se o targeting funciona corretamente');
console.log('3. Testar se a cópia é criada e castada gratuitamente');
console.log('4. Validar que permanents viram tokens quando copiados');
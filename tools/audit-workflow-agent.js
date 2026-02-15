#!/usr/bin/env node
/**
 * AUDIT WORKFLOW AGENT
 * Automatiza o processo de auditar 5 cartas por vez
 *
 * USO:
 *   node tools/audit-workflow-agent.js next5      # Audita próximas 5
 *   node tools/audit-workflow-agent.js status      # Mostra status
 *   node tools/audit-workflow-agent.js mark "Card Name" VERIFIED  # Marca como ok
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const readline = require('readline');

const TODO_FILE = path.join(__dirname, '../CARDS_AUDIT_TODO.txt');

class AuditWorkflow {
  constructor() {
    this.todos = this.parseTodoFile();
  }

  parseTodoFile() {
    const content = fs.readFileSync(TODO_FILE, 'utf8');
    const lines = content.split('\n');

    const cards = [];
    let currentBatch = null;

    for (const line of lines) {
      // Parse batch headers
      if (line.includes('BATCH') && line.includes('(')) {
        const match = line.match(/BATCH (\d+)/);
        if (match) currentBatch = `batch${match[1]}`;
        continue;
      }

      // Parse card lines: [ ] 1. Card Name
      const cardMatch = line.match(/^\s*\[(.)\]\s+(\d+)\.\s+(.+?)$/);
      if (cardMatch) {
        const [, status, num, name] = cardMatch;
        cards.push({
          number: parseInt(num),
          name: name.trim(),
          status: this.parseStatus(status),
          batch: currentBatch,
          line: line
        });
      }
    }

    return cards;
  }

  parseStatus(char) {
    const statusMap = {
      ' ': 'TODO',
      '~': 'ANALYZING',
      '!': 'PROBLEMS',
      '+': 'FIXED',
      '✓': 'VERIFIED'
    };
    return statusMap[char] || 'UNKNOWN';
  }

  statusToChar(status) {
    const charMap = {
      'TODO': ' ',
      'ANALYZING': '~',
      'PROBLEMS': '!',
      'FIXED': '+',
      'VERIFIED': '✓'
    };
    return charMap[status] || ' ';
  }

  getNextCards(count = 5) {
    return this.todos.filter(c => c.status === 'TODO').slice(0, count);
  }

  printStatus() {
    const summary = {
      TODO: this.todos.filter(c => c.status === 'TODO').length,
      ANALYZING: this.todos.filter(c => c.status === 'ANALYZING').length,
      PROBLEMS: this.todos.filter(c => c.status === 'PROBLEMS').length,
      FIXED: this.todos.filter(c => c.status === 'FIXED').length,
      VERIFIED: this.todos.filter(c => c.status === 'VERIFIED').length
    };

    console.log('\n📊 AUDIT WORKFLOW STATUS\n');
    console.log(`Total Cards: ${this.todos.length}`);
    console.log(`  [ ] TODO:       ${summary.TODO}`);
    console.log(`  [~] ANALYZING:  ${summary.ANALYZING}`);
    console.log(`  [!] PROBLEMS:   ${summary.PROBLEMS}`);
    console.log(`  [+] FIXED:      ${summary.FIXED}`);
    console.log(`  [✓] VERIFIED:   ${summary.VERIFIED}\n`);

    const progress = summary.VERIFIED + summary.FIXED;
    const percent = ((progress / this.todos.length) * 100).toFixed(1);
    console.log(`Progress: ${progress}/${this.todos.length} (${percent}%)\n`);
  }

  async auditNext5() {
    const nextCards = this.getNextCards(5);

    if (nextCards.length === 0) {
      console.log('\n✅ All cards verified! Audit complete!\n');
      return;
    }

    const cardNames = nextCards.map(c => c.name);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 AUDITING NEXT ${nextCards.length} CARDS`);
    console.log(`${'='.repeat(80)}\n`);

    console.log(`Cards to audit:`);
    nextCards.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.name} (#${c.number})`);
    });
    console.log('');

    return new Promise((resolve) => {
      const auditorScript = path.join(__dirname, 'card-completeness-auditor.js');
      const args = cardNames.map(name => `"${name}"`).join(' ');

      console.log(`Running: node card-completeness-auditor.js ${args.substring(0, 80)}...\n`);

      exec(`node "${auditorScript}" ${cardNames.map(n => `"${n}"`).join(' ')}`,
        { maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          console.log(stdout);
          if (error && !error.message.includes('exit code 0')) {
            console.error(stderr);
          }

          // Ask for next action
          this.promptNextAction(nextCards).then(resolve);
        }
      );
    });
  }

  promptNextAction(cards) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      console.log(`\n${'='.repeat(80)}`);
      console.log('NEXT ACTIONS:');
      console.log(`  1. Fix issues (code changes)            → type: fix`);
      console.log(`  2. Mark as verified (no issues)         → type: verify <card-index>`);
      console.log(`  3. Mark as problematic (needs manual)   → type: problem <card-index>`);
      console.log(`  4. Audit next batch                     → type: next`);
      console.log(`  5. Exit                                 → type: exit`);
      console.log(`${'='.repeat(80)}\n`);

      rl.question('What do you want to do? ', (answer) => {
        rl.close();

        const cmd = answer.trim().split(' ')[0].toLowerCase();
        const arg = answer.trim().split(' ')[1];

        if (cmd === 'fix') {
          console.log('\n📝 Make your code fixes now. When done, run the audit again.\n');
          resolve();
        } else if (cmd === 'verify') {
          const idx = parseInt(arg) - 1;
          if (idx >= 0 && idx < cards.length) {
            this.updateCardStatus(cards[idx].name, 'VERIFIED');
            console.log(`✅ Marked as VERIFIED: ${cards[idx].name}\n`);
          }
          resolve();
        } else if (cmd === 'problem') {
          const idx = parseInt(arg) - 1;
          if (idx >= 0 && idx < cards.length) {
            this.updateCardStatus(cards[idx].name, 'PROBLEMS');
            console.log(`⚠️  Marked as PROBLEMS: ${cards[idx].name}\n`);
          }
          resolve();
        } else if (cmd === 'next') {
          this.auditNext5().then(resolve);
        } else if (cmd === 'exit') {
          console.log('\nGoodbye!\n');
          process.exit(0);
        } else {
          console.log('Invalid command. Try again.\n');
          this.promptNextAction(cards).then(resolve);
        }
      });
    });
  }

  updateCardStatus(cardName, status) {
    let content = fs.readFileSync(TODO_FILE, 'utf8');
    const lines = content.split('\n');

    const updated = lines.map(line => {
      if (line.includes(`] ${cardName}`) || line.match(new RegExp(`\\] \\d+\\.\\s+${cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))) {
        const statusChar = this.statusToChar(status);
        return line.replace(/\[\s*[~!+✓]\s*\]/, `[${statusChar}]`);
      }
      return line;
    });

    fs.writeFileSync(TODO_FILE, lines.join('\n'), 'utf8');

    // Update summary
    this.updateSummary();
  }

  updateSummary() {
    const todos = this.parseTodoFile();
    const summary = {
      TODO: todos.filter(c => c.status === 'TODO').length,
      ANALYZING: todos.filter(c => c.status === 'ANALYZING').length,
      PROBLEMS: todos.filter(c => c.status === 'PROBLEMS').length,
      FIXED: todos.filter(c => c.status === 'FIXED').length,
      VERIFIED: todos.filter(c => c.status === 'VERIFIED').length
    };

    const total = todos.length;
    const progress = summary.VERIFIED + summary.FIXED;
    const percent = ((progress / total) * 100).toFixed(1);

    let content = fs.readFileSync(TODO_FILE, 'utf8');
    const summaryRegex = /Total Cards:.*?Progress: \d+\/\d+ \(\d+\.\d+%\)/s;
    const newSummary = `Total Cards: ${total}
Status:
  [ ] TODO:      ${summary.TODO}
  [~] ANALYZING: ${summary.ANALYZING}
  [!] PROBLEMS:   ${summary.PROBLEMS}
  [+] FIXED:      ${summary.FIXED}
  [✓] VERIFIED:   ${summary.VERIFIED}

Progress: ${progress}/${total} (${percent}%)`;

    content = content.replace(summaryRegex, newSummary);
    fs.writeFileSync(TODO_FILE, content, 'utf8');
  }
}

async function main() {
  const arg = process.argv[2];
  const workflow = new AuditWorkflow();

  if (!arg || arg === 'next5') {
    await workflow.auditNext5();
  } else if (arg === 'status') {
    workflow.printStatus();
  } else if (arg === 'mark') {
    const cardName = process.argv.slice(3, -1).join(' ');
    const status = process.argv[process.argv.length - 1];
    workflow.updateCardStatus(cardName, status);
    console.log(`✓ Updated\n`);
  } else {
    console.log(`\nUSAGE:`);
    console.log(`  node tools/audit-workflow-agent.js next5      # Audita próximas 5`);
    console.log(`  node tools/audit-workflow-agent.js status     # Mostra status`);
    console.log(`  node tools/audit-workflow-agent.js mark "Card" STATUS  # Marca card\n`);
  }
}

main().catch(console.error);

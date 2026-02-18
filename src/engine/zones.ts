// zones.ts — Zone management for card game state
// Ported from legacy zones.js

import type { GameCard } from './engine-types';

export class Zone {
  name: string;
  cards: GameCard[];

  constructor(name: string) {
    this.name = name;
    this.cards = [];
  }

  add(card: GameCard): void {
    this.cards.push(card);
  }

  addToTop(card: GameCard): void {
    this.cards.unshift(card);
  }

  addToBottom(card: GameCard): void {
    this.cards.push(card);
  }

  remove(uid: string): GameCard | null {
    const idx = this.cards.findIndex(c => c._uid === uid);
    if (idx === -1) return null;
    return this.cards.splice(idx, 1)[0];
  }

  has(uid: string): boolean {
    return this.cards.some(c => c._uid === uid);
  }

  get(uid: string): GameCard | null {
    return this.cards.find(c => c._uid === uid) || null;
  }

  count(): number {
    return this.cards.length;
  }

  clear(): void {
    this.cards = [];
  }

  shuffle(): void {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  drawFromTop(): GameCard | null {
    return this.cards.length > 0 ? this.cards.shift()! : null;
  }

  peekTop(n = 1): GameCard[] {
    return this.cards.slice(0, n);
  }

  getAll(): GameCard[] {
    return [...this.cards];
  }

  findCard(predicate: (card: GameCard) => boolean): GameCard | null {
    return this.cards.find(predicate) || null;
  }

  filterCards(predicate: (card: GameCard) => boolean): GameCard[] {
    return this.cards.filter(predicate);
  }

  removeMatching(predicate: (card: GameCard) => boolean): GameCard | null {
    const idx = this.cards.findIndex(predicate);
    if (idx === -1) return null;
    return this.cards.splice(idx, 1)[0];
  }
}

export class PlayerZones {
  library: Zone;
  hand: Zone;
  battlefield: Zone;
  graveyard: Zone;
  exile: Zone;

  constructor() {
    this.library = new Zone('library');
    this.hand = new Zone('hand');
    this.battlefield = new Zone('battlefield');
    this.graveyard = new Zone('graveyard');
    this.exile = new Zone('exile');
  }
}

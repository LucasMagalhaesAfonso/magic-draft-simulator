class Zone {
  constructor(name) {
    this.name = name;
    this.cards = [];
  }

  add(card) {
    this.cards.push(card);
  }

  addToTop(card) {
    this.cards.unshift(card);
  }

  addToBottom(card) {
    this.cards.push(card);
  }

  remove(uid) {
    const idx = this.cards.findIndex(c => c._uid === uid);
    if (idx === -1) return null;
    return this.cards.splice(idx, 1)[0];
  }

  has(uid) {
    return this.cards.some(c => c._uid === uid);
  }

  get(uid) {
    return this.cards.find(c => c._uid === uid) || null;
  }

  count() {
    return this.cards.length;
  }

  clear() {
    this.cards = [];
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  drawFromTop() {
    return this.cards.length > 0 ? this.cards.shift() : null;
  }

  peekTop(n = 1) {
    return this.cards.slice(0, n);
  }

  getAll() {
    return [...this.cards];
  }

  // Find first card matching a predicate
  findCard(predicate) {
    return this.cards.find(predicate) || null;
  }

  // Find all cards matching a predicate
  filterCards(predicate) {
    return this.cards.filter(predicate);
  }

  // Remove and return first card matching predicate
  removeMatching(predicate) {
    const idx = this.cards.findIndex(predicate);
    if (idx === -1) return null;
    return this.cards.splice(idx, 1)[0];
  }
}

class PlayerZones {
  constructor() {
    this.library = new Zone('library');
    this.hand = new Zone('hand');
    this.battlefield = new Zone('battlefield');
    this.graveyard = new Zone('graveyard');
    this.exile = new Zone('exile');
  }
}

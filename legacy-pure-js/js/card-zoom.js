const CardZoom = {
  _overlay: null,
  _img: null,
  _visible: false,

  init() {
    // Create overlay once
    this._overlay = document.createElement('div');
    this._overlay.className = 'card-zoom-overlay';
    this._overlay.innerHTML = `
      <div class="card-zoom-backdrop"></div>
      <img class="card-zoom-img" src="" alt="Card Zoom">
    `;
    this._overlay.style.display = 'none';
    document.body.appendChild(this._overlay);
    this._img = this._overlay.querySelector('.card-zoom-img');

    // Close on click anywhere
    this._overlay.addEventListener('click', () => this.hide());

    // Right-click anywhere on a card with data-zoom shows zoom
    document.addEventListener('contextmenu', (e) => {
      const zoomEl = e.target.closest('[data-zoom]');
      if (zoomEl) {
        e.preventDefault();
        this.show(zoomEl.dataset.zoom);
        return;
      }
      // Right-click on library deck shows card back/sleeve
      const libEl = e.target.closest('.game-library');
      if (libEl) {
        e.preventDefault();
        this.showCardBack();
      }
    });

    // Also close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._visible) this.hide();
    });
  },

  show(imageUrl) {
    if (!imageUrl) return;
    this._img.src = imageUrl;
    this._img.style.display = '';
    this._overlay.style.display = 'flex';
    this._visible = true;
    const cardBack = this._overlay.querySelector('.card-zoom-back');
    if (cardBack) cardBack.style.display = 'none';
  },

  showCardBack() {
    // Show the sleeve/card-back as a zoom overlay
    try {
      const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
      if (prefs.sleeve === 'custom' && prefs.sleeveArt && prefs.sleeveArt.art_crop) {
        this.show(prefs.sleeveArt.art_crop);
        return;
      }
    } catch {}
    // Default card back: show a styled overlay
    if (!this._overlay) return;
    this._img.style.display = 'none';
    this._overlay.style.display = 'flex';
    this._visible = true;
    let cardBack = this._overlay.querySelector('.card-zoom-back');
    if (!cardBack) {
      cardBack = document.createElement('div');
      cardBack.className = 'card-zoom-back';
      cardBack.style.cssText = 'width:250px;height:350px;border-radius:16px;background:linear-gradient(135deg,#2a1548 0%,#4a2d7a 30%,#3b1f68 60%,#2a1548 100%);border:3px solid rgba(218,165,32,0.6);display:flex;align-items:center;justify-content:center;box-shadow:0 0 30px rgba(218,165,32,0.15),inset 0 0 60px rgba(100,60,180,0.3);';
      cardBack.innerHTML = `
        <div style="width:200px;height:300px;border:2px solid rgba(218,165,32,0.3);border-radius:10px;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,rgba(100,60,180,0.15),transparent,rgba(100,60,180,0.15))">
          <div style="width:90px;height:90px;border:3px solid rgba(218,165,32,0.5);border-radius:50%;background:radial-gradient(circle,rgba(218,165,32,0.25),rgba(100,60,180,0.1));box-shadow:0 0 20px rgba(218,165,32,0.2)"></div>
        </div>`;
      this._overlay.appendChild(cardBack);
    }
    cardBack.style.display = 'flex';
  },

  hide() {
    this._overlay.style.display = 'none';
    this._visible = false;
    this._img.style.display = '';
    const cardBack = this._overlay.querySelector('.card-zoom-back');
    if (cardBack) cardBack.style.display = 'none';
  },

  // Helper to generate data-zoom attribute for any card
  attr(card) {
    let url = '';

    // Check if card has selected art
    if (card._selectedArtIndex !== undefined && card._allPrints && card._allPrints[card._selectedArtIndex]) {
      const selectedPrint = card._allPrints[card._selectedArtIndex];
      // Try to find large image from selected print
      url = selectedPrint.image_uris?.large ||
            selectedPrint.image_uris?.normal ||
            selectedPrint.image_large ||
            selectedPrint.image_normal ||
            selectedPrint.image_small || '';
    } else {
      // Use default image if no art selected
      url = card.image_large || card.image_normal || card.image_small || '';
    }

    return url ? `data-zoom="${url}"` : '';
  }
};

document.addEventListener('DOMContentLoaded', () => CardZoom.init());

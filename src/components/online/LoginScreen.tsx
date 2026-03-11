import { useState } from 'react';
import { registerUser, loginUser } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import './LoginScreen.css';

type Tab = 'login' | 'register';

export function LoginScreen() {
  const { setCurrentUser, setScreen } = useAppStore();
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      let user;
      if (tab === 'register') {
        if (!displayName.trim()) { setError('Escolha um nome de exibição.'); setLoading(false); return; }
        user = await registerUser(email, password, displayName.trim());
      } else {
        user = await loginUser(email, password);
      }
      setCurrentUser({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || email.split('@')[0],
      });
      setScreen('online_lobby');
    } catch (e: any) {
      const msg = e?.code === 'auth/user-not-found' ? 'Usuário não encontrado.'
        : e?.code === 'auth/wrong-password' ? 'Senha incorreta.'
        : e?.code === 'auth/invalid-credential' ? 'E-mail ou senha incorretos.'
        : e?.code === 'auth/email-already-in-use' ? 'E-mail já cadastrado.'
        : e?.code === 'auth/weak-password' ? 'Senha muito fraca (mínimo 6 caracteres).'
        : e?.code === 'auth/invalid-email' ? 'E-mail inválido.'
        : e?.code === 'auth/network-request-failed' ? 'Sem conexão com a internet.'
        : e?.message || 'Erro desconhecido.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card glass">
        <div className="login-logo">⚔️ Magic Draft</div>
        <p className="login-subtitle">Jogar Online</p>

        <div className="login-tabs">
          <button className={`login-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => setTab('login')}>
            Entrar
          </button>
          <button className={`login-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => setTab('register')}>
            Criar Conta
          </button>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {tab === 'register' && (
            <div className="login-field">
              <label>Nome de exibição</label>
              <input
                type="text"
                placeholder="Como aparecer para os amigos"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                maxLength={24}
                autoComplete="nickname"
              />
            </div>
          )}
          <div className="login-field">
            <label>E-mail</label>
            <input
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="login-field">
            <label>Senha</label>
            <input
              type="password"
              placeholder={tab === 'register' ? 'Mínimo 6 caracteres' : '••••••••'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
              required
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button className="btn btn-gold login-submit" type="submit" disabled={loading}>
            {loading ? 'Aguarde...' : tab === 'login' ? 'Entrar' : 'Criar Conta'}
          </button>
        </form>

        <button className="login-back" onClick={() => setScreen('home')}>
          ← Voltar ao Menu
        </button>
      </div>
    </div>
  );
}

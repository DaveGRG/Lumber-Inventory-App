import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { signInWithGoogle } from '../firebase/auth';

export default function SplashPage() {
  const { user, loading, authError } = useAuth();
  const navigate = useNavigate();

  const [logoVisible, setLogoVisible] = useState(false);
  const [textVisible, setTextVisible] = useState(false);
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  // Reset signing-in state when auth resolves (success or error)
  useEffect(() => {
    if (authError || user) setSigningIn(false);
  }, [authError, user]);

  // Redirect authenticated users straight to Dashboard
  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, loading, navigate]);

  // Fade-in sequence: logo at 500ms, text 125ms later
  useEffect(() => {
    if (loading) return;
    const logoTimer = setTimeout(() => setLogoVisible(true), 500);
    const txtTimer = setTimeout(() => setTextVisible(true), 625);
    return () => {
      clearTimeout(logoTimer);
      clearTimeout(txtTimer);
    };
  }, [loading]);

  const handleInteraction = useCallback(async () => {
    if (signingIn || loading) return;
    if (user) {
      navigate('/dashboard', { replace: true });
      return;
    }
    setError('');
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err.message);
      setSigningIn(false);
    }
  }, [signingIn, loading, user, navigate]);

  // Keypress triggers sign-in
  useEffect(() => {
    const onKey = (e) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      handleInteraction();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleInteraction]);

  // Show black screen while checking auth state (prevents flash)
  if (loading) {
    return <div className="h-full bg-black" />;
  }

  return (
    <div
      className="relative flex flex-col cursor-pointer select-none overflow-hidden bg-black h-full"
      onClick={handleInteraction}
    >
      {/* Background splash image — cover without stretching */}
      <img
        src="/splash.jpg"
        alt="GRG Playscapes playground"
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Dark overlay for contrast */}
      <div className="absolute inset-0 bg-black/30" />

      {/* "Click to continue" text — vertically centered */}
      <div className="relative z-10 flex-1 flex items-center justify-center">
        <div
          className="flex flex-col items-center gap-3"
          style={{
            opacity: textVisible ? 1 : 0,
            transition: 'opacity 0.4s ease-in',
          }}
        >
          <p className="text-white text-xl sm:text-2xl tracking-widest font-semibold drop-shadow-lg">
            {signingIn ? 'Signing in...' : 'Click to continue'}
          </p>

          {(error || authError) && (
            <p className="text-red-400 text-sm max-w-sm text-center px-6 bg-black/60 rounded py-2">
              {error || authError}
            </p>
          )}
        </div>
      </div>

      {/* GRG logo — bottom third */}
      <div
        className="relative z-10 flex justify-center pb-12 sm:pb-16"
        style={{
          opacity: logoVisible ? 1 : 0,
          transition: 'opacity 0.5s ease-in',
        }}
      >
        <img
          src="/grg-logo-wide.jpg"
          alt="GRG Playscapes"
          className="w-48 sm:w-64 rounded-lg shadow-2xl"
        />
      </div>
    </div>
  );
}

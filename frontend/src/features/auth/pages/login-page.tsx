import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, ArrowRight, Github } from 'lucide-react';

const LoginPage: React.FC = () => {
  const handleGoogleLogin = () => {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
    window.location.href = `${API_URL}/api/auth/google`;
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Glows */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-primary/10 blur-[120px] rounded-full -translate-y-1/2" />
      <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-blue-600/5 blur-[120px] rounded-full translate-y-1/2" />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full relative z-10"
      >
        <div className="text-center mb-10">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary shadow-2xl shadow-primary/20 mb-6">
            <Sparkles size={32} className="text-white" />
          </div>
          <h1 className="text-4xl font-black tracking-tight mb-3">Welcome Back</h1>
          <p className="text-white/40 font-medium">Sign in to manage your intent intelligence flows.</p>
        </div>

        <div className="space-y-4">
          <button 
            onClick={handleGoogleLogin}
            className="w-full py-4 px-6 rounded-2xl bg-white text-black font-bold flex items-center justify-center gap-3 hover:bg-white/90 active:scale-[0.98] transition-all shadow-xl"
          >
            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
            Continue with Google
          </button>
          
          <button className="w-full py-4 px-6 rounded-2xl bg-white/5 border border-white/10 text-white font-bold flex items-center justify-center gap-3 hover:bg-white/10 active:scale-[0.98] transition-all">
            <Github size={20} />
            Continue with GitHub
          </button>
        </div>

        <div className="mt-10 pt-10 border-t border-white/5 text-center">
          <p className="text-sm text-white/20 font-medium">
            Don't have an account? <span className="text-primary hover:underline cursor-pointer">Start for free</span>
          </p>
        </div>
      </motion.div>

      {/* Footer Branding */}
      <div className="absolute bottom-8 text-[10px] font-bold text-white/10 uppercase tracking-[0.3em]">
        © 2026 IntentFlow Technologies • Secure Intelligence
      </div>
    </div>
  );
};

export default LoginPage;

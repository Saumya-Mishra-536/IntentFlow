import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

const AuthCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (token) {
      localStorage.setItem('token', token);
      toast.success('Successfully signed in!');
      navigate('/app/dashboard');
    } else if (error) {
      toast.error(`Authentication failed: ${error}`);
      navigate('/login');
    } else {
      navigate('/login');
    }
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex flex-col items-center justify-center p-6">
      <motion.div 
        animate={{ 
          scale: [1, 1.1, 1],
          opacity: [0.5, 1, 0.5]
        }}
        transition={{ 
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className="flex flex-col items-center gap-6"
      >
        <div className="h-16 w-16 items-center justify-center rounded-2xl bg-primary flex shadow-2xl shadow-primary/20">
          <Sparkles size={32} className="text-white" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-bold mb-2 tracking-tight">Authenticating...</h2>
          <p className="text-white/40 text-sm font-medium">Finalizing your secure session.</p>
        </div>
      </motion.div>
    </div>
  );
};

export default AuthCallbackPage;

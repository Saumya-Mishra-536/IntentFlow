import React, { useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { 
  ArrowRight, 
  Zap, 
  TrendingUp, 
  Menu, 
  X,
  Globe,
  Search,
  MessageSquareQuote,
  Target,
  Workflow,
  Sparkles
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';

const intentData = [
  { name: 'Mon', intent: 450, signals: 200 },
  { name: 'Tue', intent: 520, signals: 350 },
  { name: 'Wed', intent: 610, signals: 480 },
  { name: 'Thu', intent: 890, signals: 720 },
  { name: 'Fri', intent: 750, signals: 590 },
  { name: 'Sat', intent: 980, signals: 810 },
  { name: 'Sun', intent: 1200, signals: 950 },
];

const LandingPage: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { scrollY } = useScroll();
  const navBg = useTransform(scrollY, [0, 50], ['rgba(13, 13, 13, 0)', 'rgba(13, 13, 13, 0.9)']);

  return (
    <div className="bg-[#0D0D0D] text-white overflow-hidden font-inter">
      {/* Navigation */}
      <motion.nav 
        style={{ backgroundColor: navBg }}
        className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md border-b border-white/5 px-6 py-4"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.5)]">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">IntentFlow</span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-white/60">
            <a href="#" className="hover:text-white transition-colors">Platform</a>
            <a href="#" className="hover:text-white transition-colors">AI Capture</a>
            <a href="#" className="hover:text-white transition-colors">SEO Intelligence</a>
            <a href="#" className="hover:text-white transition-colors">Integrations</a>
          </div>

          <div className="flex items-center gap-4">
            <button className="hidden md:block text-sm font-medium text-white/70 hover:text-primary transition-colors px-4">Sign In</button>
            <button className="px-6 py-2.5 bg-white text-black text-sm font-bold rounded-full hover:bg-primary hover:text-white transition-all active:scale-95 shadow-lg">
              Start Free Trial
            </button>
            <button className="md:hidden text-white/70" onClick={() => setIsMenuOpen(!isMenuOpen)}>
              {isMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </motion.nav>

      {/* Hero Section */}
      <section className="relative pt-40 pb-24 px-6">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/15 blur-[140px] rounded-full -translate-y-1/2 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-600/10 blur-[120px] rounded-full translate-y-1/2 -translate-x-1/4" />

        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-bold text-primary tracking-widest uppercase mb-8 shadow-inner">
              <span className="flex h-2 w-2 rounded-full bg-primary animate-ping" />
              Next-Gen Intent Intelligence
            </div>
            <h1 className="text-5xl lg:text-7xl font-bold tracking-tight leading-[1.05] mb-8">
              Capture Intent <br /> 
              <span className="text-white/40 italic">Before the Click</span>
            </h1>
            <p className="text-xl text-white/50 max-w-xl mb-10 leading-relaxed font-light">
              IntentFlow intercepts and analyzes AI conversations in real-time, providing deep SEO intelligence and predicting lead conversion with 98% accuracy.
            </p>
            
            <div className="flex flex-wrap items-center gap-10 pt-10 border-t border-white/5">
              <div>
                <div className="text-3xl font-bold text-white mb-1">98%</div>
                <div className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-bold">Accuracy</div>
              </div>
              <div className="w-px h-10 bg-white/10" />
              <div>
                <div className="text-3xl font-bold text-white mb-1">10M+</div>
                <div className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-bold">Signals Captured</div>
              </div>
              <div className="w-px h-10 bg-white/10" />
              <div>
                <div className="text-3xl font-bold text-white mb-1">2.4x</div>
                <div className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-bold">ROAS Boost</div>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9, rotate: -2 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            className="relative"
          >
            <div className="relative z-10 p-2 bg-gradient-to-br from-white/10 to-transparent rounded-[2rem] shadow-2xl backdrop-blur-3xl border border-white/10">
              <img 
                src="/assets/hero-3d.png" 
                alt="IntentFlow Intelligence Visual" 
                className="w-full h-auto rounded-[1.5rem] object-cover"
              />
              {/* Floating Badge */}
              <div className="absolute -bottom-6 -left-6 p-4 bg-[#1A1A1A] border border-white/10 rounded-2xl shadow-xl flex items-center gap-3 animate-bounce-slow">
                <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center text-green-500">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-xs text-white/40 font-bold uppercase tracking-wider">Conversion Intent</div>
                  <div className="text-lg font-bold text-white">+84.2% Growth</div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Trust Logos */}
      <div className="py-12 border-y border-white/5 bg-white/[0.01]">
        <div className="max-w-7xl mx-auto px-6 overflow-hidden">
          <div className="flex flex-wrap justify-center items-center gap-12 md:gap-24 opacity-30 grayscale hover:grayscale-0 transition-all duration-700">
            <span className="text-2xl font-black tracking-tighter">SEMrush</span>
            <span className="text-2xl font-black tracking-tighter">Ahrefs</span>
            <span className="text-2xl font-black tracking-tighter">HubSpot</span>
            <span className="text-2xl font-black tracking-tighter">Salesforce</span>
            <span className="text-2xl font-black tracking-tighter">OpenAI</span>
          </div>
        </div>
      </div>

      {/* Core Intelligence Features */}
      <section className="py-32 px-6">
        <div className="max-w-4xl mx-auto text-center mb-24">
          <motion.div 
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            className="text-primary text-xs font-bold uppercase tracking-[0.4em] mb-6"
          >
            Intelligence Protocol
          </motion.div>
          <h2 className="text-4xl lg:text-6xl font-bold tracking-tight mb-8 leading-tight">
            How IntentFlow Transforms Your Marketing
          </h2>
          <p className="text-white/50 text-xl font-light leading-relaxed">
            Our multi-layered AI architecture doesn't just track metrics; it understands human intent across the digital ecosystem.
          </p>
        </div>

        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              icon: <MessageSquareQuote />,
              title: "AI Chat Interception",
              desc: "Seamlessly capture and analyze user conversations across ChatGPT, Claude, and Gemini to identify product interest."
            },
            {
              icon: <Search />,
              title: "SEO Intelligence",
              desc: "Powered by SEMrush integration to provide real-time keyword snapshots and domain performance metrics."
            },
            {
              icon: <Target />,
              title: "Predictive Lead Scoring",
              desc: "Our proprietary ML models score leads based on behavioral signals, intent depth, and engagement history."
            }
          ].map((feature, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              viewport={{ once: true }}
              className="group p-10 rounded-[2.5rem] bg-white/[0.02] border border-white/10 hover:bg-white/[0.04] hover:border-primary/40 transition-all relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl group-hover:bg-primary/10 transition-colors" />
              <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-8 group-hover:text-primary transition-colors">
                {feature.icon}
              </div>
              <h3 className="text-2xl font-bold mb-6 group-hover:translate-x-1 transition-transform">{feature.title}</h3>
              <p className="text-white/40 leading-relaxed font-light">{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Analytics Insight */}
      <section className="py-32 px-6 bg-[#0B0B0B] relative">
        <div className="absolute top-1/2 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
        
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-24 items-center">
          <div className="order-2 lg:order-1">
            <div className="p-1.5 rounded-[2.5rem] bg-white/5 border border-white/10 shadow-2xl overflow-hidden">
              <div className="p-8 bg-[#0F0F0F] rounded-[2.2rem]">
                <div className="flex items-center justify-between mb-10">
                  <div>
                    <h4 className="text-lg font-bold text-white">Intent Velocity</h4>
                    <p className="text-[10px] text-white/30 uppercase tracking-widest font-bold">Real-time Lead Signals</p>
                  </div>
                  <div className="flex gap-1.5">
                    <div className="px-3 py-1 rounded-full bg-green-500/10 text-[10px] font-bold text-green-500 border border-green-500/20">LIVE</div>
                  </div>
                </div>

                <div className="h-[350px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={intentData}>
                      <defs>
                        <linearGradient id="intentGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="5 5" vertical={false} stroke="rgba(255,255,255,0.03)" />
                      <XAxis 
                        dataKey="name" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 10, fontWeight: 700 }} 
                        dy={15}
                      />
                      <YAxis hide />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#141414', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', fontSize: '12px' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="intent" 
                        stroke="#3b82f6" 
                        fillOpacity={1} 
                        fill="url(#intentGradient)" 
                        strokeWidth={4}
                        animationDuration={2000}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-10 grid grid-cols-2 gap-6">
                  <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/5 group hover:border-primary/30 transition-colors">
                    <div className="text-white/30 text-[10px] font-bold uppercase tracking-widest mb-2">Intent Threshold</div>
                    <div className="text-3xl font-black text-white">92.4<span className="text-sm text-white/20 ml-1">avg</span></div>
                    <div className="mt-4 h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        whileInView={{ width: '92.4%' }}
                        className="h-full bg-primary"
                      />
                    </div>
                  </div>
                  <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/5 group hover:border-blue-400/30 transition-colors">
                    <div className="text-white/30 text-[10px] font-bold uppercase tracking-widest mb-2">Signal Strength</div>
                    <div className="text-3xl font-black text-white">High</div>
                    <div className="mt-4 flex gap-1 items-end h-6">
                      {[40, 70, 50, 90, 100, 80].map((h, i) => (
                        <div key={i} className="bg-blue-400/30 w-full rounded-t-[2px] h-full" style={{ height: `${h}%` }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <div className="text-primary text-xs font-bold uppercase tracking-[0.4em] mb-6">Actionable Insights</div>
            <h2 className="text-4xl lg:text-5xl font-bold tracking-tight mb-8">
              Streamline Complex Lead Journeys
            </h2>
            <div className="space-y-8">
              {[
                { 
                  title: "Real-time Interception", 
                  desc: "Automatically detect when leads discuss your industry on AI platforms.",
                  icon: <Zap className="w-5 h-5 text-yellow-500" />
                },
                { 
                  title: "Domain Context Extraction", 
                  desc: "Scrape and analyze entire domains to build comprehensive lead personas.",
                  icon: <Globe className="w-5 h-5 text-blue-500" />
                },
                { 
                  title: "Multi-Version Campaigns", 
                  desc: "A/B test campaign strategies across different industries and geos.",
                  icon: <Workflow className="w-5 h-5 text-purple-500" />
                }
              ].map((item, i) => (
                <motion.div 
                  key={i} 
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex gap-6 group cursor-default"
                >
                  <div className="shrink-0 w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-white/10 transition-colors shadow-inner">
                    {item.icon}
                  </div>
                  <div>
                    <h4 className="text-lg font-bold mb-2 text-white/90 group-hover:text-white transition-colors">{item.title}</h4>
                    <p className="text-sm text-white/40 font-light leading-relaxed">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
            <button className="mt-12 px-10 py-4 bg-primary text-white text-sm font-bold rounded-full hover:shadow-[0_0_30px_rgba(59,130,246,0.4)] transition-all flex items-center gap-3 group">
              Start Capturing Intent <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      {/* CTA Footer Section */}
      <footer className="pt-32 pb-16 px-6 relative border-t border-white/5 overflow-hidden">
        <div className="absolute bottom-0 right-0 w-[800px] h-[800px] bg-primary/5 blur-[160px] rounded-full translate-y-1/2 translate-x-1/4" />
        
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 mb-32">
            <div>
              <div className="flex items-center gap-3 mb-10">
                <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <span className="text-2xl font-black tracking-tight">IntentFlow</span>
              </div>
              <p className="text-white/40 text-lg font-light max-w-sm mb-12 leading-relaxed">
                The world's first AI-powered intent intelligence platform for modern marketers.
              </p>
              <div className="flex gap-5">
                {[1, 2, 3].map(i => (
                  <div key={i} className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-primary/20 hover:border-primary/50 transition-all cursor-pointer group">
                    <div className="w-5 h-5 bg-white/20 rounded-[2px] group-hover:bg-primary transition-colors" />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-12 sm:gap-16">
              <div>
                <h5 className="text-sm font-bold uppercase tracking-[0.2em] mb-10 text-white">Platform</h5>
                <ul className="space-y-6 text-[13px] text-white/40 font-medium">
                  <li className="hover:text-primary transition-colors cursor-pointer">Intent Capture</li>
                  <li className="hover:text-primary transition-colors cursor-pointer">Lead Scoring</li>
                  <li className="hover:text-primary transition-colors cursor-pointer">SEO Intelligence</li>
                  <li className="hover:text-primary transition-colors cursor-pointer">API Reference</li>
                </ul>
              </div>
              <div>
                <h5 className="text-sm font-bold uppercase tracking-[0.2em] mb-10 text-white">Company</h5>
                <ul className="space-y-6 text-[13px] text-white/40 font-medium">
                  <li className="hover:text-primary transition-colors cursor-pointer">Our Vision</li>
                  <li className="hover:text-primary transition-colors cursor-pointer">Privacy First</li>
                  <li className="hover:text-primary transition-colors cursor-pointer">Research</li>
                  <li className="hover:text-primary transition-colors cursor-pointer">Support</li>
                </ul>
              </div>
              <div>
                <h5 className="text-sm font-bold uppercase tracking-[0.2em] mb-10 text-white">Resources</h5>
                <ul className="space-y-6 text-[13px] text-white/40 font-medium">
                  <li className="hover:text-primary transition-colors cursor-pointer">Case Studies</li>
                  <li className="hover:text-primary transition-colors cursor-pointer">Blog</li>
                  <li className="hover:text-primary transition-colors cursor-pointer">Community</li>
                </ul>
              </div>
            </div>
          </div>
          
          <div className="pt-12 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-8">
            <p className="text-[11px] text-white/20 font-bold uppercase tracking-widest">
              © 2026 IntentFlow Technologies. All rights reserved. Built for the AI era.
            </p>
            <div className="flex gap-10 text-[10px] text-white/20 font-bold uppercase tracking-widest">
              <span className="hover:text-white cursor-pointer transition-colors">Privacy Policy</span>
              <span className="hover:text-white cursor-pointer transition-colors">Terms of Intelligence</span>
              <span className="hover:text-white cursor-pointer transition-colors">System Status: Optimal</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;

import React, { useState, useEffect } from 'react';
import { Lock, User, KeyRound, AlertCircle, Eye, EyeOff, Sun, Moon } from 'lucide-react';
import { dbClient } from '../database/dbClient';
import { CashierUser } from '../types';

interface LoginScreenProps {
  onLoginSuccess: (user: CashierUser) => void;
  storeSettings: Record<string, string>;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, storeSettings }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Quick-fill active usernames cached in LocalStorage
  const [savedUsernames, setSavedUsernames] = useState<string[]>([]);

  // Persistent login theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (typeof window !== 'undefined' && localStorage.getItem('theme') as 'light' | 'dark') || 'dark'
  );

  useEffect(() => {
    // Load previously logged-in usernames
    try {
      const stored = localStorage.getItem('saved_usernames');
      if (stored) {
        const list = JSON.parse(stored);
        setSavedUsernames(Array.isArray(list) ? list : []);
        // Set first saved user by default to make logging in even faster
        if (Array.isArray(list) && list.length > 0) {
          setUsername(list[0]);
        }
      }
    } catch (e) {
      console.error('Failed to load saved usernames:', e);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (!username || !password) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور');
      setLoading(false);
      return;
    }

    try {
      let loggedUser: CashierUser | null = null;

      if (dbClient.isElectron) {
        const rows = await dbClient.dbQuery(
          'SELECT id, username, role FROM cashier_users WHERE username = ? AND password_hash = ?',
          [username, password]
        );
        if (rows && rows.length > 0) {
          loggedUser = {
            id: rows[0].id,
            username: rows[0].username,
            role: rows[0].role as 'ADMIN' | 'CASHIER'
          };
        }
      } else {
        if (username === 'admin' && password === 'admin123') {
          loggedUser = { id: 'u1', username: 'admin', role: 'ADMIN' };
        } else if (username === 'cashier' && password === 'cashier123') {
          loggedUser = { id: 'u2', username: 'cashier', role: 'CASHIER' };
        }
      }

      if (loggedUser) {
        // Cache the successful username locally
        try {
          const list = [loggedUser.username, ...savedUsernames.filter(x => x !== loggedUser.username)].slice(0, 5);
          localStorage.setItem('saved_usernames', JSON.stringify(list));
        } catch (e) {
          console.error('Failed to save username to cache:', e);
        }

        await dbClient.logActivity(loggedUser.id, loggedUser.username, 'USER_LOGIN', `تم تسجيل الدخول بنجاح بصلاحية: ${loggedUser.role}`);
        onLoginSuccess(loggedUser);
      } else {
        setError('اسم المستخدم أو كلمة المرور غير صحيحة');
        await dbClient.logActivity('UNKNOWN', username, 'LOGIN_FAILED', `محاولة تسجيل دخول فاشلة للمستخدم: ${username}`);
      }
    } catch (err) {
      console.error(err);
      setError('حدث خطأ أثناء الاتصال بقاعدة البيانات المحلية');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden transition-colors duration-200">
      
      {/* Theme toggle in login screen */}
      <div className="absolute top-4 left-4 z-10">
        <button
          type="button"
          onClick={toggleTheme}
          className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-850 dark:hover:text-slate-200 shadow-md transition-all active:scale-95"
          title={theme === 'dark' ? 'التحول للمظهر المضيء' : 'التحول للمظهر الداكن'}
        >
          {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-500" /> : <Moon className="w-5 h-5 text-blue-600" />}
        </button>
      </div>

      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl -z-10"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl -z-10"></div>

      <div className="w-full max-w-md z-10">
        {/* Brand header with image logo */}
        <div className="text-center mb-6 select-none animate-fade-in">
          <img
            src="logo-without-bg.png"
            alt="شعار الأصيل"
            className="w-28 h-28 mx-auto mb-4 object-contain"
          />
          <h1 className="font-extrabold text-2xl tracking-tight text-slate-800 dark:text-white">
            {storeSettings.store_name || 'الأصيل لقطع الغيار'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">بوابة الدخول لنظام الكاشير وإدارة المخازن</p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-slate-900/60 backdrop-blur-md border border-slate-200 dark:border-slate-800 shadow-2xl rounded-3xl p-8">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-6 text-center flex items-center justify-center gap-2">
            <Lock className="w-5 h-5 text-blue-500" />
            تسجيل الدخول للنظام
          </h2>

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-455 text-xs p-3.5 rounded-xl mb-5 flex items-center gap-2 animate-fade-in">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Quick-fill Active Usernames list */}
          {savedUsernames.length > 0 && (
            <div className="mb-5 bg-slate-50 dark:bg-slate-950/40 p-3 rounded-2xl border border-slate-200/50 dark:border-slate-800/65">
              <label className="block text-[10px] font-bold text-slate-550 dark:text-slate-400 mb-2 text-center">انقر للاختيار السريع للمستخدم</label>
              <div className="flex flex-wrap justify-center gap-1.5">
                {savedUsernames.map((u, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setUsername(u);
                      setError(null);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 ${
                      username === u
                        ? 'bg-blue-600/10 text-blue-500 border-blue-500 shadow-sm'
                        : 'bg-white dark:bg-slate-900 text-slate-650 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="w-4 h-4 rounded-full bg-blue-500/10 text-blue-600 flex items-center justify-center text-[9px] font-black">
                      {u.substring(0, 1).toUpperCase()}
                    </div>
                    <span>{u}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Username */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 pr-1">اسم المستخدم</label>
              <div className="relative">
                <User className="absolute right-3.5 top-3 w-4.5 h-4.5 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  required
                  className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-650 rounded-xl py-2.5 pr-10 pl-4 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm font-semibold"
                  placeholder="أدخل اسم المستخدم"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 pr-1">كلمة المرور</label>
              <div className="relative">
                <KeyRound className="absolute right-3.5 top-3 w-4.5 h-4.5 text-slate-400 dark:text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-650 rounded-xl py-2.5 pr-10 pl-11 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm font-mono font-bold"
                  placeholder="أدخل كلمة المرور"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3.5 top-3 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-900/10 text-sm active:scale-98 mt-2"
            >
              {loading ? 'جاري التحقق من الهوية...' : 'تسجيل الدخول'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

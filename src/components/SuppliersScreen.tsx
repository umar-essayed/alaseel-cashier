import React, { useState, useEffect } from 'react';
import { Search, History, Plus, PlusCircle, CheckCircle, X, Trash2 } from 'lucide-react';
import { dbClient } from '../database/dbClient';
import { Supplier, SupplierDebtTransaction } from '../types';

interface SuppliersScreenProps {
  currentUserId: string;
  currentUsername: string;
  onRefreshData: () => void;
}

export const SuppliersScreen: React.FC<SuppliersScreenProps> = ({
  currentUserId,
  currentUsername,
  onRefreshData
}) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [transactions, setTransactions] = useState<SupplierDebtTransaction[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Reusable custom React Alert/Confirm overlays
  const [alertConfig, setAlertConfig] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [confirmConfig, setConfirmConfig] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const showAlert = (message: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setAlertConfig({ message, type });
  };

  // Modals
  const [addSupplierModal, setAddSupplierModal] = useState(false);
  const [addTxModal, setAddTxModal] = useState(false);

  // New Supplier form
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [supAddress, setSupAddress] = useState('');
  const [supInitialDebt, setSupInitialDebt] = useState(0);

  // New Tx form
  const [txType, setTxType] = useState<'PURCHASE_DEBT' | 'PAYMENT'>('PAYMENT');
  const [txAmount, setTxAmount] = useState(0);
  const [txNotes, setTxNotes] = useState('');

  const loadSuppliers = async () => {
    try {
      const data = await dbClient.getSuppliers();
      setSuppliers(data);
      if (selectedSupplier) {
        const updatedSelected = data.find(s => s.id === selectedSupplier.id);
        if (updatedSelected) {
          setSelectedSupplier(updatedSelected);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadTransactions = async (supplierId: string) => {
    try {
      const data = await dbClient.getSupplierDebts(supplierId);
      setTransactions(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteSupplier = async (supplier: Supplier) => {
    setConfirmConfig({
      message: `هل أنت متأكد من حذف المورد "${supplier.name}" نهائياً من النظام؟ سيؤدي ذلك أيضاً لحذف جميع حركات ديونه ولا يمكن التراجع.`,
      onConfirm: async () => {
        try {
          const res = await dbClient.deleteSupplier(supplier.id, currentUserId, currentUsername);
          if (res.success) {
            showAlert('تم حذف المورد بنجاح', 'success');
            setSelectedSupplier(null);
            await loadSuppliers();
            onRefreshData();
          }
        } catch (err: any) {
          console.error(err);
          showAlert(`فشل حذف المورد: ${err.message || 'خطأ غير معروف'}`, 'error');
        }
      }
    });
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

  const handleSelectSupplier = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    loadTransactions(supplier.id);
  };

  const handleAddSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName) return;

    const id = 'sup_' + Math.random().toString(36).substr(2, 9);
    try {
      await dbClient.dbQuery(
        `INSERT INTO suppliers (id, name, phone, email, address, current_debt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, supName, supPhone, supEmail, supAddress, supInitialDebt, new Date().toISOString()]
      );

      if (supInitialDebt > 0) {
        const txId = 'debt_' + Math.random().toString(36).substr(2, 9);
        await dbClient.dbQuery(
          `INSERT INTO supplier_debts (id, supplier_id, transaction_type, amount, previous_debt, new_debt, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [txId, id, 'PURCHASE_DEBT', supInitialDebt, 0, supInitialDebt, 'رصيد مديونية افتتاحي للمورد عند التسجيل', new Date().toISOString()]
        );
      }

      await dbClient.logActivity(
        currentUserId,
        currentUsername,
        'SUPPLIER_ADDED',
        `تسجيل مورد جديد: ${supName} بمديونية افتتاحية: ${supInitialDebt}`
      );

      setAddSupplierModal(false);
      resetSupplierForm();
      loadSuppliers();
      onRefreshData();
    } catch (err) {
      console.error(err);
      showAlert('خطأ أثناء إضافة المورد بقاعدة البيانات', 'error');
    }
  };

  const handleAddTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplier || txAmount <= 0) return;

    try {
      const res = await dbClient.addSupplierDebt(
        selectedSupplier.id,
        txType,
        txAmount,
        txNotes || (txType === 'PAYMENT' ? 'سداد نقدي لحساب المورد' : 'فاتورة شراء بضاعة آجل'),
        currentUserId,
        currentUsername
      );

      if (res.success) {
        setAddTxModal(false);
        resetTxForm();
        await loadSuppliers();
        await loadTransactions(selectedSupplier.id);
        onRefreshData();
      }
    } catch (err) {
      console.error(err);
      showAlert('فشلت عملية إضافة حركة المديونية', 'error');
    }
  };

  const handleFullSettlement = async (supplier: Supplier) => {
    if (supplier.current_debt === 0) return;

    setConfirmConfig({
      message: `هل أنت متأكد من تسوية وإغلاق كامل المديونية للمورد "${supplier.name}" البالغة ${supplier.current_debt} ج.م؟ سيتم تصفير الحساب وإنشاء حركة سداد مطابقة.`,
      onConfirm: async () => {
        try {
          const res = await dbClient.addSupplierDebt(
            supplier.id,
            'SETTLEMENT',
            supplier.current_debt,
            'تسوية كاملة ومطابقة وتصفير الحساب يدوياً',
            currentUserId,
            currentUsername
          );

          if (res.success) {
            await loadSuppliers();
            if (selectedSupplier?.id === supplier.id) {
              await loadTransactions(supplier.id);
            }
            onRefreshData();
          }
        } catch (err) {
          console.error(err);
          showAlert('فشلت عملية تسوية الدين', 'error');
        }
      }
    });
  };

  const resetSupplierForm = () => {
    setSupName('');
    setSupPhone('');
    setSupEmail('');
    setSupAddress('');
    setSupInitialDebt(0);
  };

  const resetTxForm = () => {
    setTxAmount(0);
    setTxNotes('');
    setTxType('PAYMENT');
  };

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.phone && s.phone.includes(searchTerm))
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-100px)] overflow-hidden text-main">
      {/* Suppliers Directory List (5 cols) */}
      <div className="lg:col-span-5 flex flex-col h-full bg-panel border border-main rounded-2xl p-4 overflow-hidden">
        <div className="flex justify-between items-center mb-4 pb-2 border-b border-main">
          <h2 className="font-bold text-lg text-main">سجل ديون الموردين</h2>
          <button
            onClick={() => setAddSupplierModal(true)}
            className="bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-bold py-2 px-4 rounded-xl transition-all text-xs flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            مورد جديد
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-muted">
            <Search className="w-4 h-4" />
          </span>
          <input
            type="text"
            className="w-full bg-input-field border border-main text-main placeholder-slate-400 dark:placeholder-slate-650 rounded-xl py-2 pr-9 pl-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            placeholder="ابحث عن مورد بالاسم أو الهاتف..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Suppliers List */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {filteredSuppliers.map(supplier => {
            const isSelected = selectedSupplier?.id === supplier.id;
            return (
              <div
                key={supplier.id}
                onClick={() => handleSelectSupplier(supplier)}
                className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                  isSelected
                    ? 'bg-panel-hover/80 border-blue-500 shadow-md'
                    : 'bg-panel-accent hover:bg-panel-hover border-main'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-base text-main">{supplier.name}</h3>
                    <p className="text-xs text-muted mt-1">الهاتف: {supplier.phone || 'غير مسجل'}</p>
                    <p className="text-xs text-muted mt-0.5">{supplier.address || 'العنوان غير محدد'}</p>
                  </div>
                  
                  {/* Current Debt Tag */}
                  <div className="text-left">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-black border ${
                      supplier.current_debt > 0
                        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-450 border-rose-500/20'
                        : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                    }`}>
                      {supplier.current_debt.toLocaleString()} ج.م
                    </span>
                    <p className="text-[10px] text-muted mt-2 font-bold">مستحقات المورد</p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-main flex gap-2 justify-end items-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSupplier(supplier);
                    }}
                    className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-455 text-[10px] font-bold px-3 py-1.5 rounded-lg border border-rose-500/20 flex items-center gap-1 transition-all"
                    title="حذف المورد"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    حذف المورد
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectSupplier(supplier);
                      setAddTxModal(true);
                    }}
                    className="bg-main hover:bg-panel-hover text-main text-[10px] font-bold px-3 py-1.5 rounded-lg border border-main"
                  >
                    دفع / قيد دين
                  </button>
                  {supplier.current_debt > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFullSettlement(supplier);
                      }}
                      className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-all"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      تسوية كاملة
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Supplier Audit Trail / Debt Ledger (7 cols) */}
      <div className="lg:col-span-7 flex flex-col h-full bg-panel border border-main rounded-2xl p-4 overflow-hidden">
        {selectedSupplier ? (
          <div className="flex flex-col h-full">
            {/* Header info */}
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-main">
              <div>
                <span className="text-[10px] bg-main text-muted px-2 py-0.5 rounded font-bold border border-main">كشف حساب الحركة التدقيقية</span>
                <h2 className="font-bold text-xl text-main mt-1">{selectedSupplier.name}</h2>
              </div>
              
              <button
                onClick={() => setAddTxModal(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm"
              >
                <PlusCircle className="w-4.5 h-4.5" />
                حركة مالية جديدة
              </button>
            </div>

            {/* Audit Trail List */}
            <div className="flex-1 overflow-y-auto border border-main rounded-xl bg-main">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-panel-accent text-muted text-xs font-bold border-b border-main sticky top-0 z-10">
                    <th className="py-3 px-4">التاريخ والوقت</th>
                    <th className="py-3 px-4 text-center">نوع الحركة</th>
                    <th className="py-3 px-4 text-left">المبلغ</th>
                    <th className="py-3 px-4 text-left">الرصيد السابق</th>
                    <th className="py-3 px-4 text-left">الرصيد الجديد</th>
                    <th className="py-3 px-4">ملاحظات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-main text-xs font-semibold">
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        لا توجد حركات ديون سابقة مسجلة للمورد.
                      </td>
                    </tr>
                  ) : (
                    transactions.map(tx => (
                      <tr key={tx.id} className="hover:bg-panel-hover/50">
                        <td className="py-3 px-4 font-mono text-[10px] text-muted">
                          {(tx.created_at || '').replace('T', ' ').substring(0, 19)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2.5 py-0.5 rounded font-bold text-[10px] ${
                            tx.transaction_type === 'PURCHASE_DEBT' ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' :
                            tx.transaction_type === 'PAYMENT' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                            'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          }`}>
                            {tx.transaction_type === 'PURCHASE_DEBT' ? 'شراء آجل (دين)' :
                             tx.transaction_type === 'PAYMENT' ? 'سداد نقدي' : 'تسوية حساب'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-left font-black text-main font-mono">
                          {tx.amount.toLocaleString()} ج.م
                        </td>
                        <td className="py-3 px-4 text-left text-muted font-mono">
                          {tx.previous_debt.toLocaleString()} ج.م
                        </td>
                        <td className="py-3 px-4 text-left font-black text-main font-mono">
                          {tx.new_debt.toLocaleString()} ج.م
                        </td>
                        <td className="py-3 px-4 text-muted max-w-xs truncate" title={tx.notes}>
                          {tx.notes}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-muted">
            <History className="w-16 h-16 opacity-30 stroke-[1] mb-2" />
            اختر مورداً من القائمة الجانبية لعرض كشف الحساب
          </div>
        )}
      </div>

      {/* Add Supplier Modal */}
      {addSupplierModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form onSubmit={handleAddSupplierSubmit} className="bg-panel border border-main rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-2 border-b border-main">
              <h3 className="font-bold text-lg text-main">
                تسجيل مورد جديد في المنظومة
              </h3>
              <button type="button" onClick={() => setAddSupplierModal(false)} className="text-muted hover:text-main">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div>
              <label className="block text-xs text-muted mb-1 font-bold">اسم المورد / الشركة *</label>
              <input
                type="text"
                required
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main text-sm font-semibold"
                placeholder="مثال: النور للمستورد"
                value={supName}
                onChange={(e) => setSupName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-muted mb-1 font-bold">رقم الهاتف</label>
                <input
                  type="text"
                  className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main text-sm font-mono"
                  placeholder="010XXXXXXXX"
                  value={supPhone}
                  onChange={(e) => setSupPhone(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs text-muted mb-1 font-bold">البريد الإلكتروني</label>
                <input
                  type="email"
                  className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main text-sm"
                  placeholder="supplier@mail.com"
                  value={supEmail}
                  onChange={(e) => setSupEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1 font-bold">عنوان المورد</label>
              <input
                type="text"
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main text-sm"
                placeholder="مثال: الدقي، الجيزة"
                value={supAddress}
                onChange={(e) => setSupAddress(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs text-muted mb-1 font-bold">رصيد المديونية الافتتاحي المستحق للمورد (ج.م)</label>
              <input
                type="number"
                min="0"
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main font-bold"
                value={supInitialDebt}
                onChange={(e) => setSupInitialDebt(Math.max(0, Number(e.target.value)))}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl transition-all"
              >
                تسجيل وحفظ
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddSupplierModal(false);
                  resetSupplierForm();
                }}
                className="flex-1 bg-main hover:bg-panel-hover text-muted font-bold py-2.5 rounded-xl transition-all border border-main"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Transaction Modal */}
      {addTxModal && selectedSupplier && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form onSubmit={handleAddTransactionSubmit} className="bg-panel border border-main rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex justify-between items-center pb-2 border-b border-main">
              <h3 className="font-bold text-lg text-main">
                تسجيل حركة مديونية: {selectedSupplier.name}
              </h3>
              <button type="button" onClick={() => setAddTxModal(false)} className="text-muted hover:text-main">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1.5 font-bold">نوع العملية المالية</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setTxType('PAYMENT')}
                  className={`py-2.5 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-1.5 ${
                    txType === 'PAYMENT'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500 shadow-sm'
                      : 'bg-main text-muted border-main'
                  }`}
                >
                  سداد نقدي للمورد (يقلل الدين)
                </button>
                <button
                  type="button"
                  onClick={() => setTxType('PURCHASE_DEBT')}
                  className={`py-2.5 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-1.5 ${
                    txType === 'PURCHASE_DEBT'
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-455 border-rose-500 shadow-sm'
                      : 'bg-main text-muted border-main'
                  }`}
                >
                  شراء آجل (يزيد الدين)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted mb-1 font-bold">المبلغ المطلوب (ج.م) *</label>
              <input
                type="number"
                min="1"
                required
                className="w-full bg-input-field text-main rounded-xl py-2.5 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main font-mono font-bold"
                value={txAmount || ''}
                onChange={(e) => setTxAmount(Math.max(0, Number(e.target.value)))}
              />
            </div>

            <div>
              <label className="block text-xs text-muted mb-1 font-bold">ملاحظات توضيحية</label>
              <textarea
                rows={2}
                className="w-full bg-input-field text-main rounded-xl py-2 px-3 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 border border-main text-sm"
                placeholder={txType === 'PAYMENT' ? 'سداد جزء من حساب المورد...' : 'فاتورة شراء رقم...'}
                value={txNotes}
                onChange={(e) => setTxNotes(e.target.value)}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl transition-all"
              >
                تأكيد الحركة
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddTxModal(false);
                  resetTxForm();
                }}
                className="flex-1 bg-main hover:bg-panel-hover text-muted font-bold py-2.5 rounded-xl transition-all border border-main"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Custom Reusable React Alert Modal Overlay */}
      {alertConfig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in animate-fade-in text-main">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-sm space-y-4 text-center shadow-2xl">
            <div className="text-lg font-bold text-main">إشعار النظام</div>
            <p className="text-xs text-muted leading-relaxed">{alertConfig.message}</p>
            <button
              onClick={() => setAlertConfig(null)}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all active:scale-95 shadow-md"
            >
              موافق / إغلاق
            </button>
          </div>
        </div>
      )}

      {/* Custom Reusable React Confirm Modal Overlay */}
      {confirmConfig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in text-main">
          <div className="bg-panel border border-main rounded-3xl p-6 w-full max-w-sm space-y-4 text-center shadow-2xl">
            <div className="text-lg font-bold text-main">تأكيد الإجراء</div>
            <p className="text-xs text-muted leading-relaxed">{confirmConfig.message}</p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  confirmConfig.onConfirm();
                  setConfirmConfig(null);
                }}
                className="flex-1 bg-rose-600 hover:bg-rose-500 text-white font-bold py-2.5 rounded-xl text-xs transition-all active:scale-95 shadow-md"
              >
                تأكيد ومتابعة
              </button>
              <button
                onClick={() => setConfirmConfig(null)}
                className="flex-1 bg-main hover:bg-panel-hover text-muted border border-main font-bold py-2.5 rounded-xl text-xs transition-all active:scale-95"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

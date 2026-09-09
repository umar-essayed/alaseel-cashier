import React, { useState, useEffect, useRef } from 'react';
import { Users, Plus, Trash2, Phone, MapPin, FileText, DollarSign, CreditCard, ChevronLeft, X, Check, AlertCircle, Clock } from 'lucide-react';

interface CreditCustomer {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
  total_debt: number;
  created_at: string;
}

interface CustomerPayment {
  id: string;
  customer_id: string;
  amount: number;
  notes?: string;
  created_at: string;
}

interface CustomerSale {
  id: string;
  invoice_number: string;
  final_amount: number;
  total_amount: number;
  discount: number;
  payment_method: string;
  created_at: string;
}

interface CustomersScreenProps {
  currentUserId: string;
  currentUsername: string;
  onRefreshData: () => void;
}

export const CustomersScreen: React.FC<CustomersScreenProps> = ({
  currentUserId,
  currentUsername,
  onRefreshData
}) => {
  const [customers, setCustomers] = useState<CreditCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CreditCustomer | null>(null);
  const [customerDetails, setCustomerDetails] = useState<{
    payments: CustomerPayment[];
    sales: CustomerSale[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Add/Edit Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [editCustomer, setEditCustomer] = useState<Partial<CreditCustomer>>({});
  const [saving, setSaving] = useState(false);

  // Payment Modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);

  // Delete Confirm
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Notification
  const [notification, setNotification] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showNotif = (text: string, type: 'success' | 'error' = 'success') => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const loadCustomers = async () => {
    try {
      const data = await (window as any).api.getCreditCustomers();
      setCustomers(data || []);
    } catch (e) {
      console.error('Failed to load credit customers:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const handleSelectCustomer = async (cust: CreditCustomer) => {
    setSelectedCustomer(cust);
    setCustomerDetails(null);
    try {
      const details = await (window as any).api.getCustomerDetails(cust.id);
      setCustomerDetails(details);
    } catch (e) {
      console.error('Failed to load customer details:', e);
    }
  };

  const handleSaveCustomer = async () => {
    if (!editCustomer.name?.trim()) {
      showNotif('يرجى إدخال اسم العميل', 'error');
      return;
    }
    setSaving(true);
    try {
      await (window as any).api.saveCreditCustomer(editCustomer);
      showNotif(editCustomer.id ? '✅ تم تحديث بيانات العميل' : '✅ تم إضافة العميل بنجاح');
      setShowAddModal(false);
      setEditCustomer({});
      await loadCustomers();
      onRefreshData();
    } catch (e) {
      showNotif('❌ فشل الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCustomer = async (customerId: string) => {
    try {
      await (window as any).api.deleteCreditCustomer(customerId);
      showNotif('✅ تم حذف العميل');
      if (selectedCustomer?.id === customerId) {
        setSelectedCustomer(null);
        setCustomerDetails(null);
      }
      setDeleteConfirm(null);
      await loadCustomers();
    } catch (e) {
      showNotif('❌ فشل الحذف', 'error');
    }
  };

  const handleAddPayment = async () => {
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) {
      showNotif('يرجى إدخال مبلغ صحيح', 'error');
      return;
    }
    if (!selectedCustomer) return;
    setPaymentLoading(true);
    try {
      await (window as any).api.addCustomerPayment(selectedCustomer.id, amount, paymentNotes, currentUsername);
      showNotif(`✅ تم تسجيل دفعة ${amount.toLocaleString()} ج.م من ${selectedCustomer.name}`);
      setShowPaymentModal(false);
      setPaymentAmount('');
      setPaymentNotes('');
      await loadCustomers();
      await handleSelectCustomer(selectedCustomer);
      onRefreshData();
    } catch (e: any) {
      showNotif(`❌ فشل تسجيل الدفعة: ${e?.message}`, 'error');
    } finally {
      setPaymentLoading(false);
    }
  };

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.phone || '').includes(searchTerm)
  );

  const totalDebt = customers.reduce((sum, c) => sum + (c.total_debt || 0), 0);

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] gap-4 text-main">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl font-bold text-sm shadow-xl border transition-all animate-fade-in ${
          notification.type === 'error'
            ? 'bg-rose-500/90 text-white border-rose-400'
            : 'bg-emerald-500/90 text-white border-emerald-400'
        }`}>
          {notification.text}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
            <Users className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="font-extrabold text-base text-main">عملاء الآجل والدين</h2>
            <p className="text-[11px] text-muted">إدارة العملاء المسجلين بحسابات آجلة</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-2 text-center">
            <div className="text-[10px] text-muted mb-0.5">إجمالي الديون المستحقة</div>
            <div className="font-black text-rose-400 font-mono text-sm">{totalDebt.toLocaleString()} ج.م</div>
          </div>
          <button
            onClick={() => { setEditCustomer({}); setShowAddModal(true); }}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95"
          >
            <Plus className="w-4 h-4" />
            إضافة عميل جديد
          </button>
        </div>
      </div>

      {/* Main Split */}
      <div className="flex-1 flex gap-4 overflow-hidden">

        {/* Left: Customer List */}
        <div className="w-[320px] shrink-0 flex flex-col bg-panel border border-main rounded-2xl overflow-hidden">
          <div className="p-3 border-b border-main">
            <input
              type="text"
              placeholder="بحث بالاسم أو رقم الهاتف..."
              className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-xs text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {loading ? (
              <div className="text-center py-8 text-muted text-xs animate-pulse">جاري التحميل...</div>
            ) : filteredCustomers.length === 0 ? (
              <div className="text-center py-10 text-muted text-xs flex flex-col items-center gap-2">
                <Users className="w-10 h-10 opacity-30" />
                لا يوجد عملاء مسجلون
              </div>
            ) : filteredCustomers.map(cust => (
              <div
                key={cust.id}
                onClick={() => handleSelectCustomer(cust)}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedCustomer?.id === cust.id
                    ? 'border-indigo-500 bg-indigo-600/10'
                    : 'border-main bg-panel-accent hover:border-slate-400'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-xs text-main">{cust.name}</div>
                    {cust.phone && <div className="text-[10px] text-muted mt-0.5 flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{cust.phone}</div>}
                  </div>
                  <div className="text-left">
                    <div className={`font-black text-xs font-mono ${cust.total_debt > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {cust.total_debt > 0 ? `${cust.total_debt.toLocaleString()} ج.م` : '✓ مسدد'}
                    </div>
                    {cust.total_debt > 0 && <div className="text-[9px] text-muted">مديونية</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Customer Details */}
        <div className="flex-1 flex flex-col bg-panel border border-main rounded-2xl overflow-hidden">
          {selectedCustomer ? (
            <>
              {/* Customer Header */}
              <div className="p-4 border-b border-main bg-panel-accent flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                    <span className="text-xl font-black text-indigo-400">{selectedCustomer.name[0]}</span>
                  </div>
                  <div>
                    <div className="font-extrabold text-base text-main">{selectedCustomer.name}</div>
                    <div className="flex items-center gap-3 mt-1">
                      {selectedCustomer.phone && (
                        <span className="text-[10px] text-muted flex items-center gap-1"><Phone className="w-3 h-3" />{selectedCustomer.phone}</span>
                      )}
                      {selectedCustomer.address && (
                        <span className="text-[10px] text-muted flex items-center gap-1"><MapPin className="w-3 h-3" />{selectedCustomer.address}</span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      عميل منذ: {new Date(selectedCustomer.created_at).toLocaleDateString('ar-EG')}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`px-4 py-2 rounded-xl border text-center ${selectedCustomer.total_debt > 0 ? 'bg-rose-500/10 border-rose-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
                    <div className="text-[10px] text-muted">إجمالي المديونية</div>
                    <div className={`font-black text-lg font-mono ${selectedCustomer.total_debt > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {selectedCustomer.total_debt.toLocaleString()} ج.م
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button
                      onClick={() => setShowPaymentModal(true)}
                      className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-95"
                    >
                      <DollarSign className="w-3.5 h-3.5" /> تسجيل دفعة
                    </button>
                    <button
                      onClick={() => { setEditCustomer({ ...selectedCustomer }); setShowAddModal(true); }}
                      className="flex items-center gap-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 px-3 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-95"
                    >
                      ✏️ تعديل
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(selectedCustomer.id)}
                      className="flex items-center gap-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 px-3 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-95"
                    >
                      <Trash2 className="w-3 h-3" /> حذف
                    </button>
                  </div>
                </div>
              </div>

              {/* Tabs: Invoices & Payments */}
              <div className="flex-1 overflow-hidden flex flex-col p-4 gap-4">
                {/* Invoices */}
                <div className="flex-1 overflow-hidden flex flex-col">
                  <div className="font-bold text-xs text-indigo-400 mb-2 flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5" /> فواتير الآجل
                  </div>
                  <div className="flex-1 overflow-y-auto border border-main rounded-xl bg-main">
                    {!customerDetails ? (
                      <div className="text-center py-6 text-muted text-xs animate-pulse">جاري التحميل...</div>
                    ) : customerDetails.sales.length === 0 ? (
                      <div className="text-center py-6 text-muted text-xs">لا توجد فواتير مسجلة لهذا العميل</div>
                    ) : (
                      <table className="w-full text-right text-xs">
                        <thead className="bg-panel-accent border-b border-main text-muted font-bold">
                          <tr>
                            <th className="py-2 px-3">رقم الفاتورة</th>
                            <th className="py-2 px-3 text-center">التاريخ والوقت</th>
                            <th className="py-2 px-3 text-left">المبلغ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-main text-main font-semibold">
                          {customerDetails.sales.map((sale) => (
                            <tr key={sale.id} className="hover:bg-panel-hover/30">
                              <td className="py-2 px-3 font-mono text-blue-400">{sale.invoice_number}</td>
                              <td className="py-2 px-3 text-center text-muted text-[10px]">
                                {new Date(sale.created_at).toLocaleString('ar-EG')}
                              </td>
                              <td className="py-2 px-3 text-left text-rose-400 font-black font-mono">
                                {sale.final_amount.toLocaleString()} ج.م
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* Payments History */}
                <div className="h-[180px] flex flex-col">
                  <div className="font-bold text-xs text-emerald-400 mb-2 flex items-center gap-2">
                    <CreditCard className="w-3.5 h-3.5" /> سجل الدفعات المسددة
                  </div>
                  <div className="flex-1 overflow-y-auto border border-main rounded-xl bg-main">
                    {!customerDetails ? (
                      <div className="text-center py-4 text-muted text-xs animate-pulse">جاري التحميل...</div>
                    ) : customerDetails.payments.length === 0 ? (
                      <div className="text-center py-4 text-muted text-xs">لم يتم تسجيل أي دفعات بعد</div>
                    ) : (
                      <table className="w-full text-right text-xs">
                        <thead className="bg-panel-accent border-b border-main text-muted font-bold">
                          <tr>
                            <th className="py-2 px-3">التاريخ</th>
                            <th className="py-2 px-3">ملاحظات</th>
                            <th className="py-2 px-3 text-left">المبلغ المدفوع</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-main text-main font-semibold">
                          {customerDetails.payments.map((pay) => (
                            <tr key={pay.id} className="hover:bg-panel-hover/30">
                              <td className="py-2 px-3 text-muted text-[10px]">
                                {new Date(pay.created_at).toLocaleString('ar-EG')}
                              </td>
                              <td className="py-2 px-3 text-muted">{pay.notes || '—'}</td>
                              <td className="py-2 px-3 text-left text-emerald-400 font-black font-mono">
                                +{pay.amount.toLocaleString()} ج.م
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted gap-3">
              <Users className="w-16 h-16 opacity-20" />
              <p className="text-sm font-bold">اختر عميلاً من القائمة لعرض تفاصيله</p>
              <p className="text-xs opacity-60">يمكنك إضافة عملاء جدد وتتبع ديونهم ومدفوعاتهم</p>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Customer Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-panel border border-indigo-500/30 rounded-3xl p-6 w-full max-w-md shadow-2xl text-main space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base text-indigo-400">
                {editCustomer.id ? '✏️ تعديل بيانات العميل' : '➕ إضافة عميل آجل جديد'}
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-muted hover:text-main transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-muted mb-1 font-bold">اسم العميل *</label>
                <input
                  type="text"
                  autoFocus
                  placeholder="الاسم بالكامل..."
                  className="w-full bg-input-field border border-main text-main rounded-xl py-2.5 px-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={editCustomer.name || ''}
                  onChange={e => setEditCustomer(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted mb-1 font-bold">رقم الهاتف</label>
                <input
                  type="text"
                  placeholder="01xxxxxxxxx"
                  className="w-full bg-input-field border border-main text-main rounded-xl py-2.5 px-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={editCustomer.phone || ''}
                  onChange={e => setEditCustomer(prev => ({ ...prev, phone: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted mb-1 font-bold">العنوان</label>
                <input
                  type="text"
                  placeholder="المنطقة أو الحي..."
                  className="w-full bg-input-field border border-main text-main rounded-xl py-2.5 px-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={editCustomer.address || ''}
                  onChange={e => setEditCustomer(prev => ({ ...prev, address: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted mb-1 font-bold">ملاحظات</label>
                <textarea
                  placeholder="أي ملاحظات إضافية..."
                  rows={2}
                  className="w-full bg-input-field border border-main text-main rounded-xl py-2.5 px-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  value={editCustomer.notes || ''}
                  onChange={e => setEditCustomer(prev => ({ ...prev, notes: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={() => setShowAddModal(false)}
                className="py-2.5 rounded-xl bg-panel-accent border border-main text-muted hover:text-main text-xs font-bold transition-all"
              >
                إلغاء
              </button>
              <button
                onClick={handleSaveCustomer}
                disabled={saving}
                className="py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
              >
                {saving ? 'جاري الحفظ...' : editCustomer.id ? 'تحديث البيانات' : 'إضافة العميل'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Payment Modal */}
      {showPaymentModal && selectedCustomer && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-panel border border-emerald-500/30 rounded-3xl p-6 w-full max-w-sm shadow-2xl text-main space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-base text-emerald-400">💰 تسجيل دفعة سداد</h3>
              <button onClick={() => setShowPaymentModal(false)} className="text-muted hover:text-main transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-panel-accent border border-main rounded-xl p-3 text-center">
              <div className="text-xs text-muted">العميل</div>
              <div className="font-black text-sm text-main">{selectedCustomer.name}</div>
              <div className="text-xs text-rose-400 font-bold mt-1">المديونية الحالية: {selectedCustomer.total_debt.toLocaleString()} ج.م</div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-muted mb-1 font-bold">المبلغ المدفوع (ج.م) *</label>
                <input
                  type="number"
                  autoFocus
                  placeholder="0.00"
                  className="w-full bg-input-field border border-main text-main rounded-xl py-2.5 px-3 text-lg font-black text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted mb-1 font-bold">ملاحظات</label>
                <input
                  type="text"
                  placeholder="سبب الدفعة أو ملاحظة..."
                  className="w-full bg-input-field border border-main text-main rounded-xl py-2 px-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  value={paymentNotes}
                  onChange={e => setPaymentNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                onClick={() => setShowPaymentModal(false)}
                className="py-2.5 rounded-xl bg-panel-accent border border-main text-muted text-xs font-bold"
              >
                إلغاء
              </button>
              <button
                onClick={handleAddPayment}
                disabled={paymentLoading}
                className="py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
              >
                {paymentLoading ? 'جاري التسجيل...' : '✅ تأكيد الدفعة'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-panel border border-rose-500/30 rounded-3xl p-6 w-full max-w-sm shadow-2xl text-main text-center space-y-4">
            <div className="text-3xl">⚠️</div>
            <h4 className="font-extrabold text-rose-400">تأكيد حذف العميل</h4>
            <p className="text-xs text-muted">سيتم حذف بيانات العميل وجميع سجلات دفعاته. هذا الإجراء لا يمكن التراجع عنه.</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="py-2.5 rounded-xl bg-panel-accent border border-main text-muted text-xs font-bold">إلغاء</button>
              <button
                onClick={() => handleDeleteCustomer(deleteConfirm)}
                className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all active:scale-95"
              >
                🗑️ حذف نهائي
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

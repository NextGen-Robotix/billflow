export type UserRole = "admin" | "accountant" | "viewer";
export type DocumentKind = "invoice" | "quotation";
export type DocumentStatus =
  | "draft"
  | "sent"
  | "paid"
  | "partially_paid"
  | "overdue"
  | "on_hold"
  | "accepted";

export interface User {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
}
export type InsertUser = Partial<Omit<User, "id">> & Pick<User, "openId">;

export interface AppUser {
  id: number;
  companyId: number;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  active: number;
  invitedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date | null;
}
export interface Company {
  id: number;
  name: string;
  email: string;
  currency: string;
  address: string | null;
  phone: string | null;
  gstNumber: string | null;
  logoKey: string | null;
  bankOpeningBalance: string;
  bankOpeningDate: string | null;
  invoiceCounter: number;
  quotationCounter: number;
  createdAt: Date;
}
export interface Customer {
  id: number;
  companyId: number;
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface Document {
  id: number;
  companyId: number;
  customerId: number;
  kind: DocumentKind;
  number: string;
  status: DocumentStatus;
  issueDate: string;
  dueDate: string | null;
  subtotal: string;
  taxTotal: string;
  discount: string;
  discountMode: "amount" | "percent";
  total: string;
  amountPaid: string;
  notes: string | null;
  createdBy: number;
  convertedFrom: number | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface DocumentItem {
  id: number;
  documentId: number;
  name: string;
  quantity: string;
  rate: string;
  taxPercent: string;
}
export interface Payment {
  id: number;
  companyId: number;
  documentId: number;
  amount: string;
  paymentDate: string;
  mode: "bank_transfer" | "upi" | "cash" | "card" | "cheque" | "other";
  reference: string | null;
  createdBy: number;
  createdAt: Date;
}
export interface BankTransaction {
  id: number;
  companyId: number;
  transactionDate: string;
  direction: "credit" | "debit";
  amount: string;
  method: string;
  methodOther: string | null;
  purposeCategory: string;
  purposeOther: string | null;
  counterparty: string | null;
  reference: string | null;
  notes: string | null;
  createdBy: number;
  createdAt: Date;
}
export interface Expense {
  id: number;
  companyId: number;
  date: string;
  amount: string;
  purpose: string;
  kind: "invoice" | "other";
  invoiceId: number | null;
  category: string | null;
  paidBy: string;
  reimbursementStatus: "paid" | "due";
  reimbursementDueDate: string | null;
  reimbursedDate: string | null;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface ExpenseHead {
  id: number;
  companyId: number;
  name: string;
  createdBy: number;
  createdAt: Date;
}
export interface DeliveryChallan {
  id: number;
  companyId: number;
  customerId: number | null;
  number: string;
  challanDate: string;
  status: "draft" | "sent";
  consigneeName: string;
  consigneeAddress: string | null;
  placeOfDelivery: string | null;
  consigneePhone: string | null;
  consigneeGst: string | null;
  dispatchMode: "hand" | "transport";
  transporter: string | null;
  vehicleNo: string | null;
  ewayBillNo: string | null;
  total: string;
  notes: string | null;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface DeliveryChallanItem {
  id: number;
  challanId: number;
  name: string;
  hsn: string | null;
  quantity: string;
  unit: string;
  rate: string;
  total: string;
}
export interface DocumentFormat {
  id: number;
  companyId: number;
  letterheadKey: string | null;
  reservedTopMm: number;
  reservedBottomMm: number;
  updatedAt: Date;
}
export interface ActivityLog {
  id: number;
  companyId: number;
  actorId: number | null;
  actorName: string;
  action: string;
  entity: string;
  entityId: number | null;
  summary: string;
  createdAt: Date;
}
export interface NotificationLog {
  id: number;
  companyId: number;
  documentId: number | null;
  recipient: string;
  kind: "invoice" | "reminder" | "daily_alert" | "invitation";
  status: "sent" | "failed" | "blocked";
  message: string | null;
  createdAt: Date;
}
export interface Invitation {
  id: number;
  companyId: number;
  email: string;
  role: "accountant" | "viewer";
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdBy: number;
  createdAt: Date;
}
export interface SystemSetting {
  key: string;
  value: string;
  updatedAt: Date;
}
export interface DocumentCounter {
  id: number;
  companyId: number;
  year: number;
  kind: "invoice" | "quotation" | "delivery_challan";
  counter: number;
}

export type MongoRecord = { id: number; [key: string]: unknown };

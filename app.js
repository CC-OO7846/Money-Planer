"use strict";

(() => {
  const APP_VERSION = "11.2.0";
  const SCHEMA_VERSION = 12;
  const STORAGE_KEY = "clean_planner_dime_style_v1";
  const CORRUPT_PREFIX = `${STORAGE_KEY}_corrupt_`;
  const PRE_IMPORT_KEY = `${STORAGE_KEY}_pre_import`;
  const MAX_AMOUNT = 1_000_000_000_000;
  const TRANSACTION_RENDER_LIMIT = 300;
  const VIEW_IDS = new Set([
    "dashboard",
    "monthly-expense",
    "ot",
    "buy-check",
    "transactions",
    "recurring",
    "goals",
    "calendar",
    "monthly-close",
    "trend",
    "categories",
    "settings",
    "more"
  ]);

  const moneyFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "THB",
    currencyDisplay: "code",
    maximumFractionDigits: 0
  });

  const compactMoneyFormatter = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  });

  const monthFormatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric"
  });

  const shortMonthFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "2-digit"
  });

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  const defaultCategories = Object.freeze([
    { id: "rent", name: "Rent", icon: "⌂", monthlyAmount: 13_500 },
    { id: "food", name: "Food", icon: "◉", monthlyAmount: 5_500 },
    { id: "fuel", name: "Fuel / Transport", icon: "▣", monthlyAmount: 2_500 },
    { id: "utilities", name: "Utilities", icon: "ϟ", monthlyAmount: 2_200 },
    { id: "subscriptions", name: "Subscriptions", icon: "▶", monthlyAmount: 900 },
    { id: "other", name: "Other", icon: "□", monthlyAmount: 2_500 }
  ]);

  const purchaseRiskProfiles = Object.freeze({
    "Essential / Work": { cautionShare: 55, label: "Essential capacity", guidance: "Essential purchases receive the widest safe-cash allowance." },
    "Car / Repair": { cautionShare: 45, label: "Repair reserve", guidance: "Keep room for follow-up parts or labor." },
    "Tools / Gadget": { cautionShare: 30, label: "Equipment limit", guidance: "Tools and gadgets should leave most available cash intact." },
    Lifestyle: { cautionShare: 20, label: "Discretionary limit", guidance: "Lifestyle spending uses a stricter share of available cash." },
    "Travel / Experience": { cautionShare: 25, label: "Travel buffer", guidance: "Travel should retain a buffer for costs not in the ticket price." },
    Other: { cautionShare: 30, label: "General limit", guidance: "Unclassified purchases use a conservative cash limit." }
  });

  const ui = {
    activeView: "dashboard",
    transactionMonth: currentMonthKey(),
    transactionSearch: "",
    transactionCategory: "",
    transactionType: "",
    calendarOffset: 0,
    closeOffset: 0,
    purchaseAnalyzed: false,
    pendingCloseDraft: null,
    pendingReopenKey: null,
    historicalBackfillKey: null,
    pendingConfirmation: null,
    pendingImport: null,
    returnFocus: null
  };

  const runtime = {
    storageAvailable: true,
    storageMessage: "Local storage ready",
    migrationMessage: "",
    startupError: "",
    serviceWorkerReady: false,
    serviceWorkerMessage: "Checking service worker…",
    deferredInstallPrompt: null,
    toastTimer: 0,
    updateRegistration: null,
    updateRequested: false,
    updateReloaded: false,
    inMemoryImportBackup: null,
    destructiveBusy: false
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix = "id") {
    if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function todayISO() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function currentMonthKey() {
    return todayISO().slice(0, 7);
  }

  function monthDate(key) {
    return new Date(`${key}-01T12:00:00`);
  }

  function monthKeyAtOffset(offset) {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function isMonthKey(value) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value))) return false;
    return Number.isFinite(monthDate(value).getTime());
  }

  function isISODate(value) {
    if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(String(value))) return false;
    const date = new Date(`${value}T12:00:00`);
    return Number.isFinite(date.getTime()) && todayParts(date) === value;
  }

  function todayParts(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function lastDayOfMonth(key) {
    const date = monthDate(key);
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function amount(value, fallback = 0, allowNegative = false) {
    if (typeof value === "string" && value.trim() === "") return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return clamp(parsed, allowNegative ? -MAX_AMOUNT : 0, MAX_AMOUNT);
  }

  function roundMoney(value, fallback = 0, allowNegative = false) {
    const safe = amount(value, fallback, allowNegative);
    return Math.round((safe + Math.sign(safe || 1) * Number.EPSILON) * 100) / 100;
  }

  function wholeNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return clamp(Math.round(parsed), min, max);
  }

  function cleanText(value, fallback = "", maxLength = 80) {
    const text = String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim();
    return (text || fallback).slice(0, maxLength);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }

  function money(value) {
    return moneyFormatter.format(amount(value, 0, true));
  }

  function compactMoney(value) {
    const safe = amount(value, 0, true);
    const sign = safe < 0 ? "−" : safe > 0 ? "+" : "";
    return `${sign}${compactMoneyFormatter.format(Math.abs(safe))}`;
  }

  function percent(value, digits = 0) {
    const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
    return `${safe.toFixed(digits)}%`;
  }

  function emptyState(icon, title, copy) {
    return `<div class="empty-state"><div><span aria-hidden="true">${escapeHTML(icon)}</span><strong>${escapeHTML(title)}</strong><p>${escapeHTML(copy)}</p></div></div>`;
  }

  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Required interface element is missing: #${id}`);
    return node;
  }

  function freshState() {
    const createdAt = new Date().toISOString();
    const month = currentMonthKey();
    return {
      schemaVersion: SCHEMA_VERSION,
      settings: {
        baseNetIncome: 36_500,
        emergencyFund: 360_000,
        savingGoal: 3_000,
        investmentGoal: 7_000,
        salaryDay: 25
      },
      categories: clone(defaultCategories),
      transactions: [],
      recurring: [],
      goals: [],
      otByMonth: {
        [month]: { target: 3_000, actualEarned: 0, updatedAt: createdAt }
      },
      calendarOpeningBalances: {},
      closedMonths: {},
      allocationRules: {
        otEnabled: true,
        otPercent: 50,
        surplusPercent: 0,
        threshold: 5_000
      },
      allocationHistory: {},
      meta: {
        createdAt,
        updatedAt: createdAt,
        lastFullBackupAt: null,
        migratedFrom: null,
        migrationArchive: {}
      }
    };
  }

  function uniqueId(base, used, prefix) {
    let candidate = cleanText(base, "", 70).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!candidate) candidate = uid(prefix);
    let result = candidate;
    let suffix = 2;
    while (used.has(result)) result = `${candidate}-${suffix++}`;
    used.add(result);
    return result;
  }

  function normalizeCategories(rawCategories) {
    const source = Array.isArray(rawCategories) && rawCategories.length ? rawCategories : defaultCategories;
    const used = new Set();
    const categories = source.map((category, index) => {
      const requestedId = cleanText(category?.id, `category-${index + 1}`, 70);
      const id = requestedId === "other" && !used.has("other") ? (used.add("other"), "other") : uniqueId(requestedId, used, "category");
      const name = id === "other" ? "Other" : cleanText(category?.name, `Category ${index + 1}`, 60);
      return {
        id,
        name,
        icon: cleanText(category?.icon, "•", 4),
        monthlyAmount: roundMoney(category?.monthlyAmount ?? category?.budget)
      };
    });

    if (!categories.some(category => category.id === "other")) {
      categories.push({ id: "other", name: "Other", icon: "□", monthlyAmount: 0 });
    }
    return categories;
  }

  function normalizeTransactions(source, categories) {
    if (!Array.isArray(source)) return [];
    const categoryIds = new Set(categories.map(category => category.id));
    const legacyNames = new Map(categories.map(category => [category.id, category.name]));
    const used = new Set();
    const transactions = [];

    for (const item of source) {
      const transactionAmount = roundMoney(item?.amount);
      const date = isISODate(item?.date) ? item.date : todayISO();
      if (transactionAmount <= 0) continue;
      const requestedCategory = cleanText(item?.categoryId ?? item?.category, "other", 70);
      const categoryId = categoryIds.has(requestedCategory) ? requestedCategory : "other";
      const originalLabel = cleanText(item?.categoryLabel, legacyNames.get(requestedCategory) || requestedCategory || "Other", 80);
      const requestedId = cleanText(item?.id, uid("transaction"), 100);
      const id = used.has(requestedId) ? uid("transaction") : requestedId;
      used.add(id);
      transactions.push({
        id,
        name: cleanText(item?.name ?? item?.description, "Transaction", 80),
        amount: transactionAmount,
        categoryId,
        categoryLabel: originalLabel,
        date,
        recurringId: cleanText(item?.recurringId, "", 100) || null,
        recurringTag: Boolean(item?.recurringTag || item?.recurringId),
        createdAt: validTimestamp(item?.createdAt) ? new Date(item.createdAt).toISOString() : new Date().toISOString()
      });
    }
    return transactions;
  }

  function normalizeRecurring(source, categories) {
    if (!Array.isArray(source)) return [];
    const categoryIds = new Set(categories.map(category => category.id));
    const used = new Set();
    const recurringItems = [];

    for (const item of source) {
      const recurringAmount = roundMoney(item?.amount);
      if (recurringAmount <= 0) continue;
      const requestedId = cleanText(item?.id, uid("recurring"), 100);
      const id = used.has(requestedId) ? uid("recurring") : requestedId;
      used.add(id);
      const requestedCategory = cleanText(item?.categoryId ?? item?.category, "other", 70);
      recurringItems.push({
        id,
        name: cleanText(item?.name, "Recurring expense", 80),
        amount: recurringAmount,
        day: wholeNumber(item?.day, 1, 1, 28),
        categoryId: categoryIds.has(requestedCategory) ? requestedCategory : "other",
        active: item?.active !== false,
        createdAt: validTimestamp(item?.createdAt) ? new Date(item.createdAt).toISOString() : new Date().toISOString()
      });
    }
    return recurringItems;
  }

  function normalizeGoals(source) {
    if (!Array.isArray(source)) return [];
    const used = new Set();
    const goals = [];

    for (const item of source) {
      const target = roundMoney(item?.target);
      if (target <= 0) continue;
      const requestedId = cleanText(item?.id, uid("goal"), 100);
      const id = used.has(requestedId) ? uid("goal") : requestedId;
      used.add(id);
      goals.push({
        id,
        name: cleanText(item?.name, "Goal", 80),
        currentAmount: roundMoney(clamp(amount(item?.currentAmount ?? item?.current), 0, target)),
        target,
        allocationPercent: clamp(amount(item?.allocationPercent ?? item?.allocPct), 0, 100),
        createdAt: validTimestamp(item?.createdAt) ? new Date(item.createdAt).toISOString() : new Date().toISOString()
      });
    }
    return goals;
  }

  function normalizeOtByMonth(raw) {
    const normalized = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return normalized;
    for (const [key, record] of Object.entries(raw)) {
      if (!isMonthKey(key) || !record || typeof record !== "object") continue;
      normalized[key] = {
        target: roundMoney(record.target ?? record.otTarget),
        actualEarned: roundMoney(record.actualEarned ?? record.actualOtEarned ?? record.actualOT),
        updatedAt: validTimestamp(record.updatedAt) ? new Date(record.updatedAt).toISOString() : new Date().toISOString()
      };
    }
    return normalized;
  }

  function normalizedActiveFundingAmount(history, key) {
    const cycles = history[key]?.cycles || [];
    const active = [...cycles].reverse().find(cycle => cycle.status === "applied" && !cycle.undoneAt);
    return active ? amount(active.appliedAmount) : 0;
  }

  function normalizeClosedMonths(raw, allocationHistory, fallbackSalaryDay) {
    const normalized = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return normalized;
    for (const [candidateKey, item] of Object.entries(raw)) {
      if (!item || typeof item !== "object") continue;
      const key = isMonthKey(item.key) ? item.key : candidateKey;
      if (!isMonthKey(key)) continue;
      const baseNetIncome = roundMoney(item.baseNetIncome ?? item.actualBaseNetIncome ?? item.income);
      const actualOtIncome = roundMoney(item.actualOtIncome ?? item.actualOT ?? item.ot);
      const monthlyExpense = roundMoney(item.monthlyExpense ?? item.expense);
      const actualSaving = roundMoney(item.actualSaving ?? item.saving);
      const actualInvestment = roundMoney(item.actualInvestment ?? item.investment);
      const planFreeCash = roundMoney(baseNetIncome + actualOtIncome - monthlyExpense - actualSaving - actualInvestment, 0, true);
      const goalFundingApplied = roundMoney(item.goalFundingApplied, normalizedActiveFundingAmount(allocationHistory, key));
      const availableFreeCash = roundMoney(planFreeCash - goalFundingApplied, 0, true);
      const closingRaw = item.closingBalance ?? item.endingBalance;
      const projectedRaw = item.calendarProjectedBalance ?? item.projectedClosingBalance ?? closingRaw;
      const status = item.status === "reopened" ? "reopened" : "closed";
      const revision = wholeNumber(item.revision, 1, 1, 10_000);
      const auditTrail = Array.isArray(item.auditTrail) ? item.auditTrail.map(entry => ({
        id: cleanText(entry?.id, uid("audit"), 100),
        event: ["reopened", "historical-backfill"].includes(entry?.event) ? entry.event : "closed",
        at: validTimestamp(entry?.at) ? new Date(entry.at).toISOString() : new Date().toISOString(),
        revision: wholeNumber(entry?.revision, revision, 1, 10_000),
        reason: cleanText(entry?.reason, "", 180),
        snapshot: entry?.snapshot && typeof entry.snapshot === "object" ? {
          baseNetIncome: roundMoney(entry.snapshot.baseNetIncome),
          actualOtIncome: roundMoney(entry.snapshot.actualOtIncome),
          monthlyExpense: roundMoney(entry.snapshot.monthlyExpense),
          actualSaving: roundMoney(entry.snapshot.actualSaving),
          actualInvestment: roundMoney(entry.snapshot.actualInvestment),
          planFreeCash: roundMoney(entry.snapshot.planFreeCash, 0, true),
          goalFundingApplied: roundMoney(entry.snapshot.goalFundingApplied),
          availableFreeCash: roundMoney(entry.snapshot.availableFreeCash ?? entry.snapshot.freeCash, 0, true),
          closingBalance: entry.snapshot.closingBalance == null || entry.snapshot.closingBalance === "" ? null : roundMoney(entry.snapshot.closingBalance, 0, true),
          calendarProjectedBalance: entry.snapshot.calendarProjectedBalance == null || entry.snapshot.calendarProjectedBalance === "" ? null : roundMoney(entry.snapshot.calendarProjectedBalance, 0, true),
          salaryDay: wholeNumber(entry.snapshot.salaryDay, fallbackSalaryDay, 1, 28)
        } : null
      })) : [];
      normalized[key] = {
        key,
        baseNetIncome,
        actualOtIncome,
        monthlyIncome: roundMoney(baseNetIncome + actualOtIncome),
        monthlyExpense,
        actualSaving,
        actualInvestment,
        planFreeCash,
        goalFundingApplied,
        availableFreeCash,
        freeCash: availableFreeCash,
        closingBalance: closingRaw == null || closingRaw === "" ? null : roundMoney(closingRaw, 0, true),
        calendarProjectedBalance: projectedRaw == null || projectedRaw === "" ? null : roundMoney(projectedRaw, 0, true),
        salaryDay: wholeNumber(item.salaryDay, fallbackSalaryDay, 1, 28),
        closedAt: cleanText(item.closedAt, new Date().toISOString(), 40),
        status,
        revision,
        reopenedAt: status === "reopened" ? cleanText(item.reopenedAt, new Date().toISOString(), 40) : null,
        reopenReason: status === "reopened" ? cleanText(item.reopenReason, "Correction requested", 180) : null,
        snapshotType: item.snapshotType === "historical-manual" ? "historical-manual" : "standard",
        auditTrail,
        schemaVersion: SCHEMA_VERSION
      };
      if (!normalized[key].auditTrail.length) {
        normalized[key].auditTrail.push({ id: uid("audit"), event: "closed", at: normalized[key].closedAt, revision, reason: "Migrated closed snapshot", snapshot: snapshotAuditData(normalized[key]) });
      }
    }
    return normalized;
  }

  function normalizeNumericMap(raw, allowNegative = false) {
    const normalized = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return normalized;
    for (const [key, value] of Object.entries(raw)) {
      if (isMonthKey(key)) normalized[key] = roundMoney(value, 0, allowNegative);
    }
    return normalized;
  }

  function normalizeAllocationHistory(raw) {
    const normalized = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return normalized;
    for (const [key, item] of Object.entries(raw)) {
      if (!isMonthKey(key) || !item || typeof item !== "object") continue;
      const sourceCycles = Array.isArray(item.cycles) ? item.cycles : [item];
      const cycles = sourceCycles.map((cycle, index) => {
        const allocations = Array.isArray(cycle?.allocations ?? cycle?.alloc)
          ? (cycle.allocations ?? cycle.alloc).map(entry => {
              const beforeRaw = entry?.beforeAmount;
              const afterRaw = entry?.afterAmount;
              return {
                goalId: cleanText(entry?.goalId, "", 100),
                goalName: cleanText(entry?.goalName, "Goal", 80),
                amount: roundMoney(entry?.amount),
                beforeAmount: Number.isFinite(Number(beforeRaw)) ? roundMoney(beforeRaw) : null,
                afterAmount: Number.isFinite(Number(afterRaw)) ? roundMoney(afterRaw) : null
              };
            }).filter(entry => entry.goalId && entry.amount > 0)
          : [];
        const allocationTotal = roundMoney(allocations.reduce((sum, entry) => sum + entry.amount, 0));
        const requestedPool = roundMoney(cycle?.availablePool ?? cycle?.pool);
        const appliedAt = validTimestamp(cycle?.appliedAt ?? cycle?.at) ? new Date(cycle.appliedAt ?? cycle.at).toISOString() : new Date().toISOString();
        const isUndone = Boolean(cycle?.undoneAt || cycle?.status === "undone");
        const undoneAt = isUndone ? (validTimestamp(cycle?.undoneAt) ? new Date(cycle.undoneAt).toISOString() : appliedAt) : null;
        return {
          id: cleanText(cycle?.id, `funding-${key}-${index + 1}`, 100),
          availablePool: Math.max(requestedPool, allocationTotal),
          appliedAmount: allocationTotal,
          allocations,
          appliedAt,
          status: isUndone ? "undone" : "applied",
          undoneAt,
          undoReason: cleanText(cycle?.undoReason, "", 180) || null,
          legacyBalanceMutation: !Array.isArray(item.cycles) || cycle?.legacyBalanceMutation === true,
          basis: cycle?.basis && typeof cycle.basis === "object" ? {
            baseNetIncome: roundMoney(cycle.basis.baseNetIncome),
            actualOtIncome: roundMoney(cycle.basis.actualOtIncome),
            monthlyExpense: roundMoney(cycle.basis.monthlyExpense),
            savingGoal: roundMoney(cycle.basis.savingGoal),
            investmentGoal: roundMoney(cycle.basis.investmentGoal),
            planFreeCash: roundMoney(cycle.basis.planFreeCash, 0, true),
            availablePool: roundMoney(cycle.basis.availablePool),
            rules: {
              otEnabled: cycle.basis.rules?.otEnabled !== false,
              otPercent: clamp(amount(cycle.basis.rules?.otPercent), 0, 100),
              surplusPercent: clamp(amount(cycle.basis.rules?.surplusPercent), 0, 100),
              threshold: roundMoney(cycle.basis.rules?.threshold),
              goalAllocations: Array.isArray(cycle.basis.rules?.goalAllocations) ? cycle.basis.rules.goalAllocations.map(entry => ({
                goalId: cleanText(entry?.goalId, "", 100),
                allocationPercent: clamp(amount(entry?.allocationPercent), 0, 100)
              })).filter(entry => entry.goalId).sort((a, b) => a.goalId.localeCompare(b.goalId)) : []
            }
          } : null
        };
      }).filter(cycle => cycle.appliedAmount > 0 && cycle.allocations.length);
      if (cycles.length) normalized[key] = { cycles };
    }
    return normalized;
  }

  function migrateState(raw, options = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The data file does not contain a valid planner object.");

    const recognizableKeys = ["settings", "income", "categories", "transactions", "expenses", "closedMonths", "recurring", "goals", "otByMonth", "simpleOT", "ot"];
    if (options.importing && !recognizableKeys.some(key => Object.hasOwn(raw, key))) {
      throw new Error("The JSON file is not a CLEAN // PLANNER backup.");
    }

    const base = freshState();
    const sourceVersion = Number(raw.schemaVersion) || 0;
    if (sourceVersion > SCHEMA_VERSION) {
      throw new Error("This backup was created by a newer CLEAN // PLANNER version and cannot be safely imported.");
    }
    if (!options.importing && sourceVersion === SCHEMA_VERSION) validateImportSource(raw);
    const legacyStructure = !raw.settings || sourceVersion < 10;
    const needsUpgrade = sourceVersion < SCHEMA_VERSION;
    const rawSettings = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
    const categories = normalizeCategories(raw.categories);
    const allocationHistory = normalizeAllocationHistory(raw.allocationHistory);
    const state = {
      schemaVersion: SCHEMA_VERSION,
      settings: {
        baseNetIncome: roundMoney(rawSettings.baseNetIncome ?? raw.income, base.settings.baseNetIncome),
        emergencyFund: roundMoney(rawSettings.emergencyFund ?? raw.emergencyFund, base.settings.emergencyFund),
        savingGoal: roundMoney(rawSettings.savingGoal ?? raw.savingGoal, base.settings.savingGoal),
        investmentGoal: roundMoney(rawSettings.investmentGoal ?? raw.investmentGoal, base.settings.investmentGoal),
        salaryDay: wholeNumber(rawSettings.salaryDay ?? raw.salaryDay, base.settings.salaryDay, 1, 28)
      },
      categories,
      transactions: normalizeTransactions(raw.transactions ?? raw.expenses, categories),
      recurring: normalizeRecurring(raw.recurring, categories),
      goals: normalizeGoals(raw.goals),
      otByMonth: normalizeOtByMonth(raw.otByMonth),
      calendarOpeningBalances: normalizeNumericMap(raw.calendarOpeningBalances, true),
      closedMonths: normalizeClosedMonths(raw.closedMonths, allocationHistory, wholeNumber(rawSettings.salaryDay ?? raw.salaryDay, base.settings.salaryDay, 1, 28)),
      allocationRules: {
        otEnabled: raw.allocationRules?.otEnabled !== false,
        otPercent: clamp(amount(raw.allocationRules?.otPercent, base.allocationRules.otPercent), 0, 100),
        surplusPercent: clamp(amount(raw.allocationRules?.surplusPercent, base.allocationRules.surplusPercent), 0, 100),
        threshold: roundMoney(raw.allocationRules?.threshold, base.allocationRules.threshold)
      },
      allocationHistory,
      meta: {
        createdAt: cleanText(raw.meta?.createdAt, base.meta.createdAt, 40),
        updatedAt: new Date().toISOString(),
        lastFullBackupAt: Number.isFinite(Date.parse(raw.meta?.lastFullBackupAt)) ? new Date(raw.meta.lastFullBackupAt).toISOString() : null,
        migratedFrom: needsUpgrade ? sourceVersion || "legacy" : raw.meta?.migratedFrom ?? null,
        migrationArchive: raw.meta?.migrationArchive && typeof raw.meta.migrationArchive === "object" ? clone(raw.meta.migrationArchive) : {}
      }
    };

    const key = currentMonthKey();
    if (legacyStructure) {
      const legacyLogs = Array.isArray(raw.otLogs) ? raw.otLogs : [];
      const logActual = legacyLogs
        .filter(entry => isISODate(entry?.date) && entry.date.startsWith(key))
        .reduce((sum, entry) => sum + amount(entry?.net), 0);
      const simpleActualRaw = raw.simpleOT?.actualManual;
      const simpleActual = simpleActualRaw === null || simpleActualRaw === "" ? logActual : amount(simpleActualRaw, logActual);
      const legacyTarget = amount(raw.simpleOT?.target ?? raw.ot?.target);
      state.otByMonth[key] = {
        target: legacyTarget,
        actualEarned: simpleActual,
        updatedAt: new Date().toISOString()
      };
      state.meta.migrationArchive.legacyOt = {
        logs: clone(legacyLogs),
        planner: raw.ot && typeof raw.ot === "object" ? clone(raw.ot) : {},
        simple: raw.simpleOT && typeof raw.simpleOT === "object" ? clone(raw.simpleOT) : {}
      };
      if (raw.monthlyIncome && typeof raw.monthlyIncome === "object") {
        state.meta.migrationArchive.legacyMonthlyIncome = clone(raw.monthlyIncome);
      }
      runtime.migrationMessage = `Migrated legacy data to schema ${SCHEMA_VERSION}`;
    }

    if (needsUpgrade) {
      const removedContributions = Array.isArray(raw.goals) ? raw.goals.map(goal => ({
        goalId: cleanText(goal?.id, "", 100),
        goalName: cleanText(goal?.name, "Goal", 80),
        monthlyContribution: amount(goal?.monthlyContribution ?? goal?.monthly)
      })).filter(entry => entry.monthlyContribution > 0) : [];
      if (removedContributions.length && !state.meta.migrationArchive.goalMonthlyContributions) {
        state.meta.migrationArchive.goalMonthlyContributions = {
          removedAt: new Date().toISOString(),
          reason: "Removed in V11.1 because allocation rules are the canonical monthly goal-funding control.",
          entries: removedContributions
        };
      }
      runtime.migrationMessage = `Migrated existing data to schema ${SCHEMA_VERSION}`;
    }

    if (!state.otByMonth[key]) {
      state.otByMonth[key] = clone(base.otByMonth[key]);
    }

    ensureOtherCategoryReferences(state);
    validateState(state);
    return state;
  }

  function ensureOtherCategoryReferences(targetState) {
    const ids = new Set(targetState.categories.map(category => category.id));
    const other = targetState.categories.find(category => category.id === "other");
    if (!other) targetState.categories.push({ id: "other", name: "Other", icon: "□", monthlyAmount: 0 });
    for (const transaction of targetState.transactions) {
      if (!ids.has(transaction.categoryId)) transaction.categoryId = "other";
    }
    for (const item of targetState.recurring) {
      if (!ids.has(item.categoryId)) item.categoryId = "other";
    }
  }

  function assertUniqueIds(items, label) {
    const ids = new Set();
    for (const item of items) {
      if (!item?.id || ids.has(item.id)) throw new Error(`${label} contains a missing or duplicate ID.`);
      ids.add(item.id);
    }
  }

  function validTimestamp(value) {
    return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
  }

  function validateState(candidate) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Planner state must be an object.");
    if (candidate.schemaVersion !== SCHEMA_VERSION) throw new Error(`Planner state schema must be ${SCHEMA_VERSION}.`);
    for (const key of ["categories", "transactions", "recurring", "goals"]) {
      if (!Array.isArray(candidate[key])) throw new Error(`${key} must be a list.`);
      assertUniqueIds(candidate[key], key);
    }
    if (candidate.categories.filter(category => category.id === "other").length !== 1) throw new Error("The required Other category is missing or duplicated.");
    const categoryIds = new Set(candidate.categories.map(category => category.id));
    const nonNegative = (value, label) => {
      if (!Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) throw new Error(`${label} contains an invalid amount.`);
    };
    if (!candidate.settings || typeof candidate.settings !== "object") throw new Error("Settings are missing.");
    for (const value of [candidate.settings.baseNetIncome, candidate.settings.emergencyFund, candidate.settings.savingGoal, candidate.settings.investmentGoal]) nonNegative(value, "Settings");
    if (!Number.isInteger(candidate.settings.salaryDay) || candidate.settings.salaryDay < 1 || candidate.settings.salaryDay > 28) throw new Error("Salary day must be between 1 and 28.");
    candidate.categories.forEach(category => nonNegative(category.monthlyAmount, "Category"));
    candidate.transactions.forEach(transaction => {
      nonNegative(transaction.amount, "Transaction");
      if (transaction.amount <= 0 || !isISODate(transaction.date)) throw new Error("A transaction has an invalid amount or date.");
      if (!categoryIds.has(transaction.categoryId)) throw new Error("A transaction references a missing category.");
    });
    candidate.recurring.forEach(item => {
      nonNegative(item.amount, "Recurring expense");
      if (item.amount <= 0 || !Number.isInteger(item.day) || item.day < 1 || item.day > 28) throw new Error("A recurring expense has invalid values.");
      if (!categoryIds.has(item.categoryId)) throw new Error("A recurring expense references a missing category.");
    });
    let allocationTotal = 0;
    candidate.goals.forEach(goal => {
      nonNegative(goal.currentAmount, "Goal");
      nonNegative(goal.target, "Goal");
      if (goal.target <= 0 || goal.currentAmount > goal.target) throw new Error("A goal balance is outside its target.");
      if (!Number.isFinite(goal.allocationPercent) || goal.allocationPercent < 0 || goal.allocationPercent > 100) throw new Error("A goal allocation is invalid.");
      allocationTotal += goal.allocationPercent;
    });
    if (allocationTotal > 100.0001) throw new Error("Goal allocations exceed 100%.");
    if (!candidate.otByMonth || typeof candidate.otByMonth !== "object" || Array.isArray(candidate.otByMonth)) throw new Error("OT history must be a month map.");
    for (const [key, record] of Object.entries(candidate.otByMonth)) {
      if (!isMonthKey(key)) throw new Error("OT history contains an invalid month key.");
      nonNegative(record.target, "OT");
      nonNegative(record.actualEarned, "OT");
      if (!validTimestamp(record.updatedAt)) throw new Error("OT history contains an invalid timestamp.");
    }
    if (!candidate.allocationHistory || typeof candidate.allocationHistory !== "object" || Array.isArray(candidate.allocationHistory)) throw new Error("Goal Funding history must be a month map.");
    for (const [key, record] of Object.entries(candidate.allocationHistory)) {
      if (!isMonthKey(key) || !Array.isArray(record.cycles)) throw new Error("Goal Funding history contains an invalid month record.");
      assertUniqueIds(record.cycles, `Goal Funding ${key}`);
      if (record.cycles.filter(cycle => cycle.status === "applied" && !cycle.undoneAt).length > 1) throw new Error(`Goal Funding ${key} has more than one active cycle.`);
      for (const cycle of record.cycles) {
        nonNegative(cycle.availablePool, "Goal Funding");
        nonNegative(cycle.appliedAmount, "Goal Funding");
        if (!Array.isArray(cycle.allocations) || !validTimestamp(cycle.appliedAt)) throw new Error("Goal Funding contains an invalid allocation or timestamp.");
        const allocationSum = cycle.allocations.reduce((sum, entry) => sum + entry.amount, 0);
        cycle.allocations.forEach(entry => nonNegative(entry.amount, "Goal Funding allocation"));
        if (Math.abs(roundMoney(allocationSum) - cycle.appliedAmount) > 0.01 || cycle.appliedAmount > cycle.availablePool + 0.01) throw new Error("Goal Funding totals do not reconcile.");
        if (cycle.status === "applied" && cycle.allocations.some(entry => !candidate.goals.some(goal => goal.id === entry.goalId))) throw new Error("Active Goal Funding references a missing goal.");
        if (!['applied', 'undone'].includes(cycle.status) || (cycle.status === "undone" && !validTimestamp(cycle.undoneAt))) throw new Error("Goal Funding contains an invalid status.");
      }
    }
    if (!candidate.closedMonths || typeof candidate.closedMonths !== "object" || Array.isArray(candidate.closedMonths)) throw new Error("Closed months must be a month map.");
    for (const [key, snapshot] of Object.entries(candidate.closedMonths)) {
      if (!isMonthKey(key) || snapshot.key !== key || !["closed", "reopened"].includes(snapshot.status)) throw new Error("A monthly snapshot has invalid identity or status.");
      if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1 || !Array.isArray(snapshot.auditTrail) || !snapshot.auditTrail.length) throw new Error("A monthly snapshot has invalid revision history.");
      for (const value of [snapshot.baseNetIncome, snapshot.actualOtIncome, snapshot.monthlyExpense, snapshot.actualSaving, snapshot.actualInvestment, snapshot.goalFundingApplied]) nonNegative(value, "Monthly snapshot");
      for (const value of [snapshot.planFreeCash, snapshot.availableFreeCash, snapshot.calendarProjectedBalance, snapshot.closingBalance]) {
        if (value != null && (!Number.isFinite(value) || Math.abs(value) > MAX_AMOUNT)) throw new Error("A monthly snapshot contains an invalid cash value.");
      }
      if (Math.abs(roundMoney(snapshot.baseNetIncome + snapshot.actualOtIncome) - snapshot.monthlyIncome) > 0.01) throw new Error("A monthly snapshot income does not reconcile.");
      if (Math.abs(roundMoney(snapshot.planFreeCash - snapshot.goalFundingApplied, 0, true) - snapshot.availableFreeCash) > 0.01) throw new Error("A monthly snapshot Free Cash does not reconcile.");
      assertUniqueIds(snapshot.auditTrail, `Snapshot audit ${key}`);
      let previousRevision = 0;
      for (const entry of snapshot.auditTrail) {
        if (!["closed", "reopened", "historical-backfill"].includes(entry.event) || !validTimestamp(entry.at)) throw new Error("A snapshot audit entry is invalid.");
        if (!Number.isInteger(entry.revision) || entry.revision < previousRevision || entry.revision > snapshot.revision) throw new Error("Snapshot audit revisions are not monotonic.");
        previousRevision = entry.revision;
      }
      if (previousRevision !== snapshot.revision) throw new Error("Snapshot revision does not match its audit trail.");
    }
    if (!candidate.allocationRules || typeof candidate.allocationRules !== "object") throw new Error("Goal Funding rules are missing.");
    if (![candidate.allocationRules.otPercent, candidate.allocationRules.surplusPercent].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) throw new Error("Goal Funding rule percentages are invalid.");
    nonNegative(candidate.allocationRules.threshold, "Goal Funding rules");
    if (!candidate.calendarOpeningBalances || typeof candidate.calendarOpeningBalances !== "object" || Array.isArray(candidate.calendarOpeningBalances)) throw new Error("Calendar opening balances must be a month map.");
    for (const [key, value] of Object.entries(candidate.calendarOpeningBalances)) {
      if (!isMonthKey(key) || !Number.isFinite(value) || Math.abs(value) > MAX_AMOUNT) throw new Error("Calendar opening balances contain invalid data.");
    }
    return true;
  }

  function validateImportSource(raw) {
    const sourceVersion = Number(raw?.schemaVersion) || 0;
    if (sourceVersion > SCHEMA_VERSION) throw new Error("This backup was created by a newer CLEAN // PLANNER version and cannot be safely imported.");
    for (const key of ["categories", "transactions", "recurring", "goals"]) {
      if (Object.hasOwn(raw, key) && !Array.isArray(raw[key])) throw new Error(`${key} must be a list.`);
      if (Array.isArray(raw[key])) {
        const ids = raw[key].map(item => cleanText(item?.id, "", 100)).filter(Boolean);
        if (new Set(ids).size !== ids.length) throw new Error(`${key} contains duplicate IDs.`);
      }
    }
    if (Array.isArray(raw.transactions)) {
      for (const transaction of raw.transactions) {
        if (Object.hasOwn(transaction || {}, "date") && !isISODate(transaction.date)) throw new Error("The backup contains an invalid transaction date.");
        if (Object.hasOwn(transaction || {}, "amount") && (!Number.isFinite(Number(transaction.amount)) || Number(transaction.amount) < 0)) throw new Error("The backup contains an invalid transaction amount.");
      }
    }
  }

  function storage() {
    try {
      const store = globalThis.localStorage;
      const probe = `${STORAGE_KEY}_probe`;
      store.setItem(probe, "1");
      store.removeItem(probe);
      return store;
    } catch (error) {
      runtime.storageAvailable = false;
      runtime.storageMessage = `Memory-only mode: ${cleanText(error?.message, "localStorage is unavailable", 140)}`;
      return null;
    }
  }

  function loadState() {
    const store = storage();
    if (!store) return freshState();
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) {
      runtime.storageMessage = "Local storage ready — new planner";
      return freshState();
    }

    try {
      const migrated = migrateState(JSON.parse(raw));
      runtime.storageMessage = runtime.migrationMessage || "Local storage ready";
      return migrated;
    } catch (error) {
      const backupKey = `${CORRUPT_PREFIX}${Date.now()}`;
      try {
        store.setItem(backupKey, raw);
        runtime.storageMessage = `Recovered with defaults; original data saved as ${backupKey}`;
        runtime.startupError = `Stored planner data failed validation. Safe defaults were loaded and the original data was preserved as ${backupKey}.`;
      } catch (backupError) {
        runtime.storageMessage = `Recovered in memory; corrupt data could not be backed up: ${cleanText(backupError?.message, "storage error", 120)}`;
        runtime.startupError = "Stored planner data failed validation. Safe defaults were loaded in memory, but the corrupt source could not be backed up.";
      }
      runtime.migrationMessage = cleanText(error?.message, "Stored data was corrupt", 180);
      return freshState();
    }
  }

  let state = loadState();

  function persist() {
    state.schemaVersion = SCHEMA_VERSION;
    state.meta.updatedAt = new Date().toISOString();
    validateState(state);
    const store = storage();
    if (!store) {
      renderRuntimeStatus();
      return false;
    }
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(state));
      runtime.storageAvailable = true;
      runtime.storageMessage = runtime.migrationMessage || "Local storage ready";
      renderRuntimeStatus();
      return true;
    } catch (error) {
      runtime.storageAvailable = false;
      runtime.storageMessage = `Changes remain in memory: ${cleanText(error?.message, "storage write failed", 140)}`;
      renderRuntimeStatus();
      return false;
    }
  }

  function showPersistenceToast(message, saved) {
    showToast(saved ? `${message} · saved locally` : `${message} · changed in memory only`, !saved);
  }

  function categoryById(id) {
    return state.categories.find(category => category.id === id) || state.categories.find(category => category.id === "other");
  }

  function transactionCategoryName(transaction) {
    const category = categoryById(transaction.categoryId);
    if (transaction.categoryId === "other" && transaction.categoryLabel && transaction.categoryLabel !== "Other") {
      return transaction.categoryLabel;
    }
    return category?.name || transaction.categoryLabel || "Other";
  }

  function plannedMonthlyExpense() {
    return roundMoney(state.categories.reduce((sum, category) => sum + amount(category.monthlyAmount), 0));
  }

  function otForMonth(key = currentMonthKey()) {
    const record = state.otByMonth[key];
    if (record) return { target: amount(record.target), actualEarned: amount(record.actualEarned) };
    const previous = Object.keys(state.otByMonth)
      .filter(month => isMonthKey(month) && month < key)
      .sort()
      .at(-1);
    return { target: previous ? amount(state.otByMonth[previous]?.target) : 0, actualEarned: 0 };
  }

  function activeGoalFundingCycle(key = currentMonthKey()) {
    const cycles = state.allocationHistory[key]?.cycles || [];
    return [...cycles].reverse().find(cycle => cycle.status === "applied" && !cycle.undoneAt) || null;
  }

  function goalFundingAppliedForMonth(key = currentMonthKey()) {
    return roundMoney(activeGoalFundingCycle(key)?.appliedAmount);
  }

  function activeFundingForGoal(goalId, key = currentMonthKey()) {
    const cycle = activeGoalFundingCycle(key);
    return cycle ? cycle.allocations.filter(entry => entry.goalId === goalId).reduce((sum, entry) => sum + amount(entry.amount), 0) : 0;
  }

  function isClosedSnapshot(snapshot) {
    return Boolean(snapshot && snapshot.status !== "reopened");
  }

  function calculateFinance(overrides = {}) {
    const key = overrides.key || currentMonthKey();
    const ot = overrides.actualOtIncome ?? otForMonth(key).actualEarned;
    const baseNetIncome = roundMoney(overrides.baseNetIncome ?? state.settings.baseNetIncome);
    const actualOtIncome = roundMoney(ot);
    const monthlyIncome = roundMoney(baseNetIncome + actualOtIncome);
    const monthlyExpense = roundMoney(overrides.monthlyExpense ?? plannedMonthlyExpense());
    const savingGoal = roundMoney(overrides.savingGoal ?? state.settings.savingGoal);
    const investmentGoal = roundMoney(overrides.investmentGoal ?? state.settings.investmentGoal);
    const savingInvestment = roundMoney(savingGoal + investmentGoal);
    const planFreeCash = roundMoney(monthlyIncome - monthlyExpense - savingGoal - investmentGoal, 0, true);
    const goalFundingApplied = roundMoney(overrides.goalFundingApplied ?? goalFundingAppliedForMonth(key));
    const availableFreeCash = roundMoney(planFreeCash - goalFundingApplied, 0, true);
    const savingRate = monthlyIncome > 0 ? (savingInvestment / monthlyIncome) * 100 : 0;
    const emergencyMonths = monthlyExpense > 0 ? state.settings.emergencyFund / monthlyExpense : 0;
    const expenseRatio = monthlyIncome > 0 ? (monthlyExpense / monthlyIncome) * 100 : 100;

    let healthScore = 100;
    if (availableFreeCash < 0) healthScore -= 40;
    else if (monthlyIncome > 0 && availableFreeCash < monthlyIncome * 0.1) healthScore -= 16;
    if (savingRate < 10) healthScore -= 18;
    else if (savingRate < 20) healthScore -= 8;
    if (emergencyMonths < 1) healthScore -= 26;
    else if (emergencyMonths < 3) healthScore -= 16;
    else if (emergencyMonths < 6) healthScore -= 7;
    if (expenseRatio > 80) healthScore -= 10;

    return {
      key,
      baseNetIncome,
      actualOtIncome,
      monthlyIncome,
      monthlyExpense,
      savingGoal,
      investmentGoal,
      savingInvestment,
      planFreeCash,
      goalFundingApplied,
      availableFreeCash,
      freeCash: availableFreeCash,
      savingRate,
      emergencyMonths,
      expenseRatio,
      healthScore: clamp(Math.round(healthScore), 0, 100)
    };
  }

  function goalFundingPool(finance = calculateFinance()) {
    if (activeGoalFundingCycle(finance.key)) return 0;
    return fundingPoolFromFinance(finance);
  }

  function fundingPoolFromFinance(finance) {
    const rules = state.allocationRules;
    const availableCash = Math.max(0, finance.availableFreeCash);
    const otComponent = rules.otEnabled ? finance.actualOtIncome * (rules.otPercent / 100) : 0;
    const surplusBase = Math.max(0, finance.availableFreeCash - rules.threshold);
    const surplusComponent = surplusBase * (rules.surplusPercent / 100);
    return roundMoney(Math.min(availableCash, Math.max(0, otComponent + surplusComponent)));
  }

  function currentFundingBasis(key = currentMonthKey()) {
    const finance = calculateFinance({ key, goalFundingApplied: 0 });
    return {
      baseNetIncome: finance.baseNetIncome,
      actualOtIncome: finance.actualOtIncome,
      monthlyExpense: finance.monthlyExpense,
      savingGoal: finance.savingGoal,
      investmentGoal: finance.investmentGoal,
      planFreeCash: finance.planFreeCash,
      availablePool: fundingPoolFromFinance(finance),
      rules: {
        otEnabled: state.allocationRules.otEnabled,
        otPercent: state.allocationRules.otPercent,
        surplusPercent: state.allocationRules.surplusPercent,
        threshold: state.allocationRules.threshold,
        goalAllocations: state.goals.map(goal => ({ goalId: goal.id, allocationPercent: goal.allocationPercent })).sort((a, b) => a.goalId.localeCompare(b.goalId))
      }
    };
  }

  function fundingBasisChanged(cycle, key = currentMonthKey()) {
    if (!cycle?.basis) return true;
    const current = currentFundingBasis(key);
    const moneyKeys = ["baseNetIncome", "actualOtIncome", "monthlyExpense", "savingGoal", "investmentGoal", "planFreeCash", "availablePool"];
    if (moneyKeys.some(name => Math.abs(roundMoney(cycle.basis[name], 0, true) - roundMoney(current[name], 0, true)) > 0.01)) return true;
    return cycle.basis.rules?.otEnabled !== current.rules.otEnabled
      || Number(cycle.basis.rules?.otPercent) !== Number(current.rules.otPercent)
      || Number(cycle.basis.rules?.surplusPercent) !== Number(current.rules.surplusPercent)
      || Math.abs(roundMoney(cycle.basis.rules?.threshold) - roundMoney(current.rules.threshold)) > 0.01
      || JSON.stringify(cycle.basis.rules?.goalAllocations || []) !== JSON.stringify(current.rules.goalAllocations);
  }

  function summaryForMonth(key) {
    const closed = state.closedMonths[key];
    if (isClosedSnapshot(closed)) {
      const monthlyIncome = roundMoney(closed.baseNetIncome + closed.actualOtIncome);
      return {
        key,
        baseNetIncome: closed.baseNetIncome,
        actualOtIncome: closed.actualOtIncome,
        monthlyIncome,
        monthlyExpense: closed.monthlyExpense,
        saving: closed.actualSaving,
        investment: closed.actualInvestment,
        planFreeCash: closed.planFreeCash,
        goalFundingApplied: closed.goalFundingApplied,
        availableFreeCash: closed.availableFreeCash,
        freeCash: closed.availableFreeCash,
        savingRate: monthlyIncome > 0 ? ((closed.actualSaving + closed.actualInvestment) / monthlyIncome) * 100 : 0,
        source: closed.snapshotType === "historical-manual" ? "MANUAL" : "CLOSED"
      };
    }
    if (key === currentMonthKey()) {
      const finance = calculateFinance({ key });
      return {
        key,
        baseNetIncome: finance.baseNetIncome,
        actualOtIncome: finance.actualOtIncome,
        monthlyIncome: finance.monthlyIncome,
        monthlyExpense: finance.monthlyExpense,
        saving: finance.savingGoal,
        investment: finance.investmentGoal,
        planFreeCash: finance.planFreeCash,
        goalFundingApplied: finance.goalFundingApplied,
        availableFreeCash: finance.availableFreeCash,
        freeCash: finance.availableFreeCash,
        savingRate: finance.savingRate,
        source: "LIVE"
      };
    }
    return null;
  }

  function showToast(message, isError = false) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    clearTimeout(runtime.toastTimer);
    toast.textContent = cleanText(message, "Done", 240);
    toast.classList.toggle("is-error", isError);
    toast.hidden = false;
    runtime.toastTimer = window.setTimeout(() => {
      toast.hidden = true;
      toast.classList.remove("is-error");
    }, 4200);
  }

  function showApplicationError(error) {
    const banner = document.getElementById("errorBanner");
    if (!banner) return;
    const message = cleanText(error?.message, "Unknown error", 220);
    banner.textContent = message === "This backup was created by a newer CLEAN // PLANNER version and cannot be safely imported."
      ? message
      : `CLEAN // PLANNER could not complete that action: ${message}`;
    banner.hidden = false;
  }

  function clearApplicationError() {
    const banner = document.getElementById("errorBanner");
    if (banner) banner.hidden = true;
  }

  function clearFormError(form) {
    const error = form?.querySelector("[data-form-error]");
    if (error) {
      error.hidden = true;
      error.textContent = "";
    }
    form?.querySelectorAll("[aria-invalid='true']").forEach(field => {
      field.removeAttribute("aria-invalid");
      if (field.getAttribute("aria-describedby") === error?.id) field.removeAttribute("aria-describedby");
    });
  }

  function showFormError(form, error) {
    if (!form) return;
    let output = form.querySelector("[data-form-error]");
    if (!output) {
      output = document.createElement("p");
      output.id = `${form.id}Error`;
      output.className = "form-error";
      output.dataset.formError = "true";
      output.setAttribute("role", "alert");
      form.querySelector(".modal-actions")?.before(output);
    }
    output.textContent = cleanText(error?.message, "Check the highlighted field.", 220);
    output.hidden = false;
    const fields = [...form.querySelectorAll("input:not([type='hidden']), select")];
    const target = fields.find(field => field.required && !field.value)
      || fields.find(field => field.validity && !field.validity.valid)
      || fields[0];
    if (target) {
      target.setAttribute("aria-invalid", "true");
      target.setAttribute("aria-describedby", output.id);
      target.focus();
    }
  }

  function safely(action) {
    try {
      clearApplicationError();
      return action();
    } catch (error) {
      showApplicationError(error);
      return null;
    }
  }

  function updateNavigation() {
    document.querySelectorAll(".view").forEach(view => {
      const active = view.id === ui.activeView;
      view.classList.toggle("is-active", active);
      view.toggleAttribute("hidden", !active);
    });
    document.querySelectorAll("[data-view]").forEach(control => {
      const active = control.dataset.view === ui.activeView;
      control.classList.toggle("is-active", active);
      if (active) control.setAttribute("aria-current", "page");
      else control.removeAttribute("aria-current");
    });
  }

  function navigate(viewId, focusHeading = true) {
    if (!VIEW_IDS.has(viewId)) throw new Error(`Unknown navigation target: ${viewId}`);
    ui.activeView = viewId;
    updateNavigation();
    renderActiveView();
    history.replaceState(null, "", `${location.pathname}${location.search}#${viewId}`);
    window.scrollTo({ top: 0, behavior: "auto" });
    if (focusHeading) {
      const heading = byId(viewId).querySelector("h1");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    }
  }

  function renderDashboard() {
    const finance = calculateFinance();
    const ot = otForMonth();
    const needed = Math.max(0, ot.target - ot.actualEarned);
    byId("dashboardFreeCash").textContent = money(finance.availableFreeCash);
    byId("dashboardFreeCashDetail").textContent = `Plan Free Cash ${money(finance.planFreeCash)} − Goal Funding ${money(finance.goalFundingApplied)}`;
    const cashStatus = byId("dashboardCashStatus");
    cashStatus.textContent = finance.availableFreeCash < 0 ? "PLAN DEFICIT" : finance.availableFreeCash === 0 ? "FULLY ALLOCATED" : "ON TRACK";
    cashStatus.className = `status-chip ${finance.availableFreeCash < 0 ? "status-chip--danger" : "status-chip--good"}`;
    byId("dashboardIncome").textContent = money(finance.monthlyIncome);
    byId("dashboardIncomeDetail").textContent = `Base ${money(finance.baseNetIncome)} + Actual OT ${money(finance.actualOtIncome)}`;
    byId("dashboardExpense").textContent = money(finance.monthlyExpense);
    byId("dashboardGoalsPlan").textContent = money(finance.savingInvestment);
    byId("dashboardSavingRate").textContent = `${percent(finance.savingRate, 1)} of income`;
    byId("dashboardEmergency").textContent = money(state.settings.emergencyFund);
    byId("dashboardEmergencyMonths").textContent = `${finance.emergencyMonths.toFixed(1)} months of expense`;
    byId("dashboardOtActual").textContent = money(finance.actualOtIncome);
    byId("dashboardOtNeeded").textContent = ot.target <= 0 ? "Set an OT target" : needed > 0 ? `${money(needed)} still needed` : "Target hit";
    byId("snapshotBase").textContent = money(finance.baseNetIncome);
    byId("snapshotOt").textContent = money(finance.actualOtIncome);
    byId("snapshotOtNeeded").textContent = money(needed);
    byId("snapshotPlanFreeCash").textContent = money(finance.planFreeCash);
    byId("snapshotFundingApplied").textContent = money(finance.goalFundingApplied);
    byId("snapshotPool").textContent = money(goalFundingPool(finance));

    const score = finance.healthScore;
    const ring = byId("healthRing");
    ring.style.setProperty("--score", score);
    ring.setAttribute("aria-label", `Financial health score ${score} out of 100`);
    byId("healthScore").textContent = String(score);
    const healthTag = byId("healthTag");
    const healthHeadline = byId("healthHeadline");
    const healthDescription = byId("healthDescription");
    if (score >= 80) {
      healthTag.textContent = "HEALTHY";
      healthTag.className = "status-chip status-chip--good";
      healthHeadline.textContent = "Strong position";
      healthDescription.textContent = "Your cash buffer and planned allocations are working together well.";
    } else if (score >= 60) {
      healthTag.textContent = "WATCH";
      healthTag.className = "status-chip status-chip--amber";
      healthHeadline.textContent = "Stable, with pressure";
      healthDescription.textContent = "Review Available Free Cash, saving rate, or emergency coverage before adding commitments.";
    } else {
      healthTag.textContent = "ACTION";
      healthTag.className = "status-chip status-chip--danger";
      healthHeadline.textContent = "Plan needs attention";
      healthDescription.textContent = "Reduce planned costs or allocations until Available Free Cash and reserves recover.";
    }
    renderSmartInsights(finance, ot);
  }

  function daysUntilPayday() {
    const now = new Date();
    const candidate = new Date(now.getFullYear(), now.getMonth(), clamp(state.settings.salaryDay, 1, 28), 12);
    if (candidate <= now) candidate.setMonth(candidate.getMonth() + 1);
    return Math.max(1, Math.ceil((candidate.getTime() - now.getTime()) / 86_400_000));
  }

  function renderSmartInsights(finance, ot) {
    const insights = [];
    const days = daysUntilPayday();
    const daily = roundMoney(finance.availableFreeCash / days, 0, true);
    insights.push(daily < 0
      ? { icon: "!", tone: "amber", title: `Plan shortfall ${money(Math.abs(finance.availableFreeCash))}`, copy: "This is a planning shortfall, not a live bank balance. Reduce planned commitments or add income." }
      : { icon: "÷", tone: "mint", title: `${money(daily)}/day plan allowance`, copy: `Planning allowance across ${days} day${days === 1 ? "" : "s"} until payday, based on Available Free Cash—not live spending or your bank balance.` });

    const needed = Math.max(0, ot.target - ot.actualEarned);
    insights.push({
      icon: "ϟ",
      tone: "amber",
      title: ot.target <= 0 ? "Set an OT target" : needed > 0 ? `${money(needed)} OT still needed` : "OT target reached",
      copy: ot.target <= 0 ? "A target makes OT progress measurable." : `${percent(ot.target > 0 ? Math.min(100, (ot.actualEarned / ot.target) * 100) : 0, 1)} complete this month.`
    });

    const bestGoal = state.goals
      .filter(goal => goal.target > 0)
      .map(goal => ({ ...goal, progress: (goal.currentAmount / goal.target) * 100 }))
      .sort((a, b) => b.progress - a.progress)[0];
    if (bestGoal) {
      insights.push({ icon: "◆", tone: "mint", title: `${bestGoal.name} ${percent(Math.min(100, bestGoal.progress), 0)} complete`, copy: `${money(Math.max(0, bestGoal.target - bestGoal.currentAmount))} remaining.` });
    } else {
      insights.push({ icon: "◆", tone: "mint", title: "No active goals yet", copy: "Create a goal to track progress and funding." });
    }

    const previousClosed = state.closedMonths[monthKeyAtOffset(-1)];
    if (previousClosed) {
      const change = finance.monthlyExpense - previousClosed.monthlyExpense;
      insights.push({
        icon: change > 0 ? "↑" : change < 0 ? "↓" : "=",
        tone: change > 0 ? "amber" : "mint",
        title: change === 0 ? "Monthly Expense is unchanged" : `Monthly Expense ${change > 0 ? "increased" : "decreased"} ${money(Math.abs(change))}`,
        copy: "Compared with last month’s closed snapshot."
      });
    } else {
      insights.push({ icon: "▣", tone: "mint", title: `Emergency Fund covers ${finance.emergencyMonths.toFixed(1)} months`, copy: "Coverage uses the current planned Monthly Expense." });
    }

    byId("smartInsights").innerHTML = insights.map(item => `<article class="insight-card"><span class="insight-icon ${item.tone === "amber" ? "insight-icon--amber" : ""}" aria-hidden="true">${escapeHTML(item.icon)}</span><div><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(item.copy)}</p></div></article>`).join("");
  }

  function renderMonthlyExpense() {
    const total = plannedMonthlyExpense();
    byId("expenseTotal").textContent = money(total);
    byId("expenseCategoryCount").textContent = `${state.categories.length} categor${state.categories.length === 1 ? "y" : "ies"}`;
    byId("categoryPlanList").innerHTML = state.categories.map(category => {
      const share = total > 0 ? (category.monthlyAmount / total) * 100 : 0;
      return `<article class="category-plan-card"><div class="category-plan-main"><span class="category-icon" aria-hidden="true">${escapeHTML(category.icon)}</span><div class="category-plan-copy"><h2>${escapeHTML(category.name)}</h2><strong class="category-plan-amount">${money(category.monthlyAmount)}</strong><small>${percent(share, 1)} of Monthly Expense</small></div></div><div class="category-plan-editor"><label class="visually-hidden" for="plan-${escapeHTML(category.id)}">${escapeHTML(category.name)} monthly amount</label><span class="money-input"><b>THB</b><input id="plan-${escapeHTML(category.id)}" class="monthly-expense-input" data-category-id="${escapeHTML(category.id)}" type="number" min="0" step="100" inputmode="decimal" value="${category.monthlyAmount}"></span><button type="button" class="button button--primary" data-action="save-category-plan" data-id="${escapeHTML(category.id)}">Save</button></div></article>`;
    }).join("");
  }

  function renderOT() {
    const key = currentMonthKey();
    const ot = otForMonth(key);
    const finance = calculateFinance();
    const needed = Math.max(0, ot.target - ot.actualEarned);
    const progress = ot.target > 0 ? Math.min(100, (ot.actualEarned / ot.target) * 100) : 0;
    const status = ot.target <= 0 ? "SET TARGET" : ot.actualEarned >= ot.target ? "TARGET HIT" : "NEED MORE";

    byId("otTargetInput").value = String(ot.target);
    byId("otActualInput").value = String(ot.actualEarned);
    byId("otStillNeeded").textContent = money(needed);
    byId("otProgressBar").style.width = `${progress}%`;
    byId("otProgressText").textContent = percent(progress, 1);
    byId("otMonthlyIncome").textContent = money(finance.monthlyIncome);
    byId("otFreeCash").textContent = money(finance.availableFreeCash);
    byId("otFreeCashDetail").textContent = `Plan ${money(finance.planFreeCash)} less funding ${money(finance.goalFundingApplied)}`;
    byId("otStatusText").textContent = status;
    byId("otStatusDetail").textContent = status === "SET TARGET" ? "Enter a target to begin" : status === "NEED MORE" ? `${money(needed)} remaining` : "Actual OT met the target";
    const statusChip = byId("otStatus");
    statusChip.textContent = status;
    statusChip.className = `status-chip ${status === "TARGET HIT" ? "status-chip--good" : "status-chip--amber"}`;
  }

  function renderBuyCheck() {
    const finance = calculateFinance();
    byId("buyPlanFreeCash").textContent = money(finance.planFreeCash);
    byId("buyBefore").textContent = money(finance.availableFreeCash);
    if (!ui.purchaseAnalyzed) {
      byId("buyAfter").textContent = money(finance.availableFreeCash);
      byId("buyAfter").className = finance.availableFreeCash < 0 ? "danger-text" : "good-text";
      byId("buyShare").textContent = "0%";
      byId("buyCategoryRisk").textContent = "Not analyzed";
      byId("buyDecisionMark").textContent = "?";
      byId("buyDecisionMark").className = "decision-mark";
      byId("buyDecisionLabel").textContent = "READY TO ANALYZE";
      byId("buyDecisionTitle").textContent = "Enter a price";
      byId("buyDecisionCopy").textContent = "The result will use Available Free Cash, priority, and category risk.";
    }
  }

  function analyzePurchase() {
    const price = amount(byId("buyPrice").value);
    if (price <= 0) throw new Error("Enter a purchase price greater than zero.");
    const priority = byId("buyPriority").value;
    const category = byId("buyCategory").value;
    const profile = purchaseRiskProfiles[category] || purchaseRiskProfiles.Other;
    const finance = calculateFinance();
    const after = finance.availableFreeCash - price;
    const share = finance.availableFreeCash > 0 ? (price / finance.availableFreeCash) * 100 : 100;
    const priorityAdjustment = priority === "need" ? 10 : priority === "want" ? -5 : 0;
    const cautionShare = clamp(profile.cautionShare + priorityAdjustment, 10, 70);
    let label = "SAFE RANGE";
    let title = "Affordable within this plan";
    let copy = `${profile.guidance} This stays within the ${percent(cautionShare)} category limit.`;
    let symbol = "✓";
    let tone = "";

    if (after < 0) {
      label = "NOT RECOMMENDED";
      title = "This exceeds Available Free Cash";
      copy = `It creates a ${money(Math.abs(after))} shortfall. Change the plan or wait.`;
      symbol = "×";
      tone = "is-danger";
    } else if (share > cautionShare) {
      label = "CAUTION";
      title = `${category} purchase has high impact`;
      copy = `${profile.guidance} This uses ${percent(share, 1)} of Available Free Cash, above the ${percent(cautionShare)} limit.`;
      symbol = "!";
      tone = "is-warn";
    }

    const mark = byId("buyDecisionMark");
    mark.textContent = symbol;
    mark.className = `decision-mark ${tone}`.trim();
    byId("buyDecisionLabel").textContent = label;
    byId("buyDecisionTitle").textContent = title;
    byId("buyDecisionCopy").textContent = copy;
    byId("buyPlanFreeCash").textContent = money(finance.planFreeCash);
    byId("buyBefore").textContent = money(finance.availableFreeCash);
    byId("buyAfter").textContent = money(after);
    byId("buyAfter").className = after < 0 ? "danger-text" : "good-text";
    byId("buyShare").textContent = percent(share, 1);
    byId("buyCategoryRisk").textContent = `${profile.label} · caution above ${percent(cautionShare)}`;
    ui.purchaseAnalyzed = true;
  }

  function fillCategoryOptions(select, selectedId = "") {
    select.innerHTML = state.categories.map(category => `<option value="${escapeHTML(category.id)}">${escapeHTML(category.name)}</option>`).join("");
    select.value = state.categories.some(category => category.id === selectedId) ? selectedId : "other";
  }

  function renderTransactions() {
    const categoryFilter = byId("transactionCategoryFilter");
    const previousCategory = ui.transactionCategory;
    categoryFilter.innerHTML = `<option value="">All categories</option>${state.categories.map(category => `<option value="${escapeHTML(category.id)}">${escapeHTML(category.name)}</option>`).join("")}`;
    categoryFilter.value = state.categories.some(category => category.id === previousCategory) ? previousCategory : "";
    byId("transactionSearch").value = ui.transactionSearch;
    byId("transactionMonth").value = ui.transactionMonth;
    byId("transactionTypeFilter").value = ui.transactionType;

    const categoryMap = new Map(state.categories.map(category => [category.id, category]));
    const categoryName = transaction => transaction.categoryId === "other" && transaction.categoryLabel && transaction.categoryLabel !== "Other"
      ? transaction.categoryLabel
      : categoryMap.get(transaction.categoryId)?.name || transaction.categoryLabel || "Other";
    const query = ui.transactionSearch.toLowerCase();
    const items = state.transactions
      .filter(transaction => transaction.date.startsWith(ui.transactionMonth))
      .filter(transaction => !query || transaction.name.toLowerCase().includes(query) || categoryName(transaction).toLowerCase().includes(query))
      .filter(transaction => !ui.transactionCategory || transaction.categoryId === ui.transactionCategory)
      .filter(transaction => !ui.transactionType || (ui.transactionType === "recurring" ? transaction.recurringTag : !transaction.recurringTag))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

    const total = items.reduce((sum, transaction) => sum + transaction.amount, 0);
    const visibleItems = items.slice(0, TRANSACTION_RENDER_LIMIT);
    byId("transactionSummary").textContent = `${items.length} transaction${items.length === 1 ? "" : "s"} · ${money(total)}${items.length > visibleItems.length ? ` · showing first ${visibleItems.length}` : ""}`;
    byId("transactionList").innerHTML = visibleItems.length ? visibleItems.map(transaction => `<article class="record-card"><div class="record-main"><span class="category-icon" aria-hidden="true">${escapeHTML(categoryMap.get(transaction.categoryId)?.icon || "□")}</span><div class="record-copy"><h2 class="record-title">${escapeHTML(transaction.name)}</h2><div class="record-meta"><span>${escapeHTML(dateFormatter.format(new Date(`${transaction.date}T12:00:00`)))}</span><span>${escapeHTML(categoryName(transaction))}</span>${transaction.recurringTag ? "<span>Recurring</span>" : ""}</div></div></div><div class="record-side"><strong class="record-amount">${money(transaction.amount)}</strong><div class="record-actions"><button type="button" class="button button--secondary" data-action="edit-transaction" data-id="${escapeHTML(transaction.id)}">Edit</button><button type="button" class="button button--danger" data-action="delete-transaction" data-id="${escapeHTML(transaction.id)}">Delete</button></div></div></article>`).join("") : emptyState("≡", "No matching transactions", "Add a transaction or adjust the month and filters.");
  }

  function recurringStatus(item, key = currentMonthKey(), paidRecurringIds = null) {
    if (!item.active) return { label: "PAUSED", tone: "" };
    const paid = paidRecurringIds ? paidRecurringIds.has(item.id) : state.transactions.some(transaction => transaction.recurringId === item.id && transaction.date.startsWith(key));
    if (paid) return { label: "PAID", tone: "status-chip--good" };
    if (key < currentMonthKey()) return { label: "DUE", tone: "status-chip--danger" };
    if (key > currentMonthKey()) return { label: "UPCOMING", tone: "" };
    const today = Number(todayISO().slice(-2));
    return item.day <= today ? { label: "DUE", tone: "status-chip--amber" } : { label: "UPCOMING", tone: "" };
  }

  function renderRecurring() {
    const key = currentMonthKey();
    const paidRecurringIds = new Set(state.transactions.filter(transaction => transaction.date.startsWith(key) && transaction.recurringId).map(transaction => transaction.recurringId));
    const statuses = state.recurring.map(item => recurringStatus(item, key, paidRecurringIds));
    byId("recurringUpcomingCount").textContent = String(statuses.filter(status => status.label === "UPCOMING").length);
    byId("recurringDueCount").textContent = String(statuses.filter(status => status.label === "DUE").length);
    byId("recurringPaidCount").textContent = String(statuses.filter(status => status.label === "PAID").length);
    const items = [...state.recurring].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
    byId("recurringList").innerHTML = items.length ? items.map(item => {
      const status = recurringStatus(item, key, paidRecurringIds);
      return `<article class="record-card"><div class="record-main"><span class="category-icon" aria-hidden="true">${escapeHTML(categoryById(item.categoryId)?.icon || "□")}</span><div class="record-copy"><h2 class="record-title">${escapeHTML(item.name)}</h2><div class="record-meta"><span>Due day ${item.day}</span><span>${escapeHTML(categoryById(item.categoryId)?.name || "Other")}</span><span class="status-chip ${status.tone}">${status.label}</span></div></div></div><div class="record-side"><strong class="record-amount">${money(item.amount)}</strong><div class="record-actions">${item.active && status.label !== "PAID" ? `<button type="button" class="button button--primary" data-action="pay-recurring" data-id="${escapeHTML(item.id)}">Mark Paid</button>` : ""}<button type="button" class="button button--secondary" data-action="edit-recurring" data-id="${escapeHTML(item.id)}">Edit</button><button type="button" class="button button--danger" data-action="delete-recurring" data-id="${escapeHTML(item.id)}">Delete</button></div></div></article>`;
    }).join("") : emptyState("↻", "No recurring expenses", "Add rent, subscriptions, or other regular bills.");
  }

  function renderGoals() {
    const finance = calculateFinance();
    const pool = goalFundingPool(finance);
    const key = currentMonthKey();
    const activeCycle = activeGoalFundingCycle(key);
    const planChanged = Boolean(activeCycle && fundingBasisChanged(activeCycle, key));
    const monthClosed = isClosedSnapshot(state.closedMonths[key]);
    const totalAllocation = state.goals.reduce((sum, goal) => sum + goal.allocationPercent, 0);
    byId("goalFundingPool").textContent = money(pool);
    byId("goalFundingSource").textContent = activeCycle
      ? "Funding is applied; undo it before applying a replacement"
      : state.allocationRules.otEnabled ? "Capped by Available Free Cash; uses Actual OT" : "Capped by Available Free Cash; OT funding is off";
    byId("goalAvailableFreeCash").textContent = money(finance.availableFreeCash);
    byId("goalFundingApplied").textContent = `${money(finance.goalFundingApplied)} applied this month`;
    const status = byId("allocationStatus");
    status.textContent = percent(totalAllocation, 1);
    status.className = `status-chip ${totalAllocation > 100 ? "status-chip--danger" : totalAllocation === 100 ? "status-chip--good" : "status-chip--amber"}`;
    byId("applyGoalFundingButton").disabled = Boolean(activeCycle || monthClosed || pool <= 0 || totalAllocation <= 0 || totalAllocation > 100);
    byId("undoGoalFundingButton").disabled = Boolean(!activeCycle || monthClosed);
    const warning = byId("goalFundingWarning");
    warning.hidden = !planChanged;
    const balanceButton = document.querySelector('[data-action="balance-goals"]');
    if (balanceButton) balanceButton.disabled = Boolean(activeCycle || monthClosed || !state.goals.some(goal => goal.currentAmount < goal.target));

    const items = [...state.goals].sort((a, b) => (a.currentAmount / a.target) - (b.currentAmount / b.target));
    byId("goalList").innerHTML = items.length ? items.map(goal => {
      const progress = Math.min(100, (goal.currentAmount / goal.target) * 100);
      const fundedNow = activeFundingForGoal(goal.id, key);
      return `<article class="record-card"><div class="record-main"><span class="category-icon" aria-hidden="true">◆</span><div class="record-copy"><h2 class="record-title">${escapeHTML(goal.name)}</h2><div class="record-meta"><span>${money(goal.currentAmount)} of ${money(goal.target)}</span><span>${percent(goal.allocationPercent, 1)} allocation</span>${fundedNow > 0 ? `<span>${money(fundedNow)} funded this month</span>` : ""}</div></div></div><div class="record-side"><strong class="record-amount">${percent(progress, 1)}</strong><div class="record-actions"><button type="button" class="button button--secondary" data-action="edit-goal" data-id="${escapeHTML(goal.id)}" ${fundedNow > 0 ? "disabled" : ""}>Edit</button><button type="button" class="button button--danger" data-action="delete-goal" data-id="${escapeHTML(goal.id)}" ${fundedNow > 0 ? "disabled" : ""}>Delete</button></div></div><div class="goal-progress-wrap"><div class="goal-progress-meta"><span>${money(Math.max(0, goal.target - goal.currentAmount))} remaining</span><span>${goal.currentAmount >= goal.target ? "Target reached" : "In progress"}</span></div><div class="progress-track"><i style="width:${progress}%"></i></div></div></article>`;
    }).join("") : emptyState("◆", "No goals yet", "Create a goal with a target and allocation percentage.");

    const cycles = [...(state.allocationHistory[key]?.cycles || [])].reverse();
    byId("goalFundingHistory").innerHTML = cycles.length ? cycles.map(cycle => {
      const allocations = cycle.allocations.map(entry => `${escapeHTML(entry.goalName || state.goals.find(goal => goal.id === entry.goalId)?.name || "Goal")}: ${money(entry.amount)}`).join(" · ");
      const isApplied = cycle.status === "applied" && !cycle.undoneAt;
      const changed = isApplied && fundingBasisChanged(cycle, key);
      return `<article class="record-card"><div class="record-main"><span class="category-icon" aria-hidden="true">${isApplied ? "→" : "↶"}</span><div class="record-copy"><h2 class="record-title">${money(cycle.appliedAmount)} ${isApplied ? "applied" : "undone"}</h2><div class="record-meta"><span>${escapeHTML(dateFormatter.format(new Date(cycle.appliedAt)))}</span><span>${allocations}</span>${cycle.undoReason ? `<span>${escapeHTML(cycle.undoReason)}</span>` : ""}</div></div></div><div class="record-side"><span class="status-chip ${changed ? "status-chip--amber" : isApplied ? "status-chip--good" : ""}">${changed ? "PLAN CHANGED" : isApplied ? "APPLIED" : "UNDONE"}</span></div></article>`;
    }).join("") : emptyState("→", "No funding applied", "Apply funding once allocations and the available pool are ready.");
  }

  function financialInputsForCalendar(key, overrides = {}) {
    if (Object.hasOwn(overrides, "baseIncome") || Object.hasOwn(overrides, "actualOt") || Object.hasOwn(overrides, "salaryDay")) {
      return {
        baseIncome: roundMoney(overrides.baseIncome),
        actualOt: roundMoney(overrides.actualOt),
        salaryDay: wholeNumber(overrides.salaryDay, state.settings.salaryDay, 1, 28),
        source: cleanText(overrides.source, "review values", 60)
      };
    }
    const snapshot = state.closedMonths[key];
    if (snapshot) {
      return {
        baseIncome: snapshot.baseNetIncome,
        actualOt: snapshot.actualOtIncome,
        salaryDay: snapshot.salaryDay,
        source: isClosedSnapshot(snapshot) ? `frozen snapshot · salary day ${snapshot.salaryDay}` : `reopened snapshot · salary day ${snapshot.salaryDay}`
      };
    }
    if (key === currentMonthKey()) return { baseIncome: state.settings.baseNetIncome, actualOt: otForMonth(key).actualEarned, salaryDay: state.settings.salaryDay, source: "live state" };
    if (key > currentMonthKey()) return { baseIncome: state.settings.baseNetIncome, actualOt: 0, salaryDay: state.settings.salaryDay, source: "future plan" };
    return { baseIncome: 0, actualOt: 0, salaryDay: state.settings.salaryDay, source: "unclosed history" };
  }

  function buildCalendar(key, overrides = {}) {
    const date = monthDate(key);
    const year = date.getFullYear();
    const monthIndex = date.getMonth();
    const lastDay = lastDayOfMonth(key);
    const leading = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
    const openingBalance = roundMoney(state.calendarOpeningBalances[key], 0, true);
    const financial = financialInputsForCalendar(key, overrides);
    const snapshot = state.closedMonths[key];
    const goalFundingApplied = roundMoney(
      Object.hasOwn(overrides, "goalFundingApplied")
        ? overrides.goalFundingApplied
        : isClosedSnapshot(snapshot) ? snapshot.goalFundingApplied
          : key === currentMonthKey() ? goalFundingAppliedForMonth(key)
            : snapshot ? snapshot.goalFundingApplied : 0
    );
    const events = new Map();
    const add = (day, type, eventAmount, label, stableId) => {
      const safeDay = clamp(wholeNumber(day, 1, 1, lastDay), 1, lastDay);
      if (!events.has(safeDay)) events.set(safeDay, []);
      events.get(safeDay).push({ type, amount: eventAmount, label, stableId });
    };

    if (financial.baseIncome > 0) add(financial.salaryDay, "income", financial.baseIncome, "Base Salary", "salary");
    if (financial.actualOt > 0) {
      const otDay = key === currentMonthKey() && !Object.hasOwn(overrides, "salaryDay") ? Number(todayISO().slice(-2)) : financial.salaryDay;
      add(otDay, "ot", financial.actualOt, "Actual OT Earned", "actual-ot");
    }
    if (goalFundingApplied > 0) {
      const cycle = activeGoalFundingCycle(key);
      const cycleDate = cycle?.appliedAt ? new Date(cycle.appliedAt) : null;
      const fundingDay = cycleDate && Number.isFinite(cycleDate.getTime()) && todayParts(cycleDate).startsWith(key)
        ? cycleDate.getDate()
        : financial.salaryDay;
      add(fundingDay, "funding", -goalFundingApplied, "Goal Funding Transfer", "goal-funding");
    }

    const monthTransactions = state.transactions
      .filter(transaction => transaction.date.startsWith(key))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    for (const transaction of monthTransactions) {
      add(Number(transaction.date.slice(-2)), "expense", -transaction.amount, transaction.name, transaction.id);
    }

    const postedRecurringIds = new Set(monthTransactions.map(transaction => transaction.recurringId).filter(Boolean));
    const recurring = [...state.recurring].filter(item => item.active).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
    for (const item of recurring) {
      const posted = postedRecurringIds.has(item.id);
      if (!posted) add(item.day, "scheduled", -item.amount, `${item.name} (scheduled)`, item.id);
    }

    for (const dayEvents of events.values()) {
      dayEvents.sort((a, b) => a.type.localeCompare(b.type) || a.stableId.localeCompare(b.stableId));
    }

    let running = openingBalance;
    let cells = "";
    for (let index = 0; index < leading; index += 1) cells += '<div class="calendar-cell is-muted" role="gridcell" aria-hidden="true"></div>';
    for (let day = 1; day <= lastDay; day += 1) {
      const dayEvents = events.get(day) || [];
      const total = dayEvents.reduce((sum, event) => sum + event.amount, 0);
      running = roundMoney(running + total, 0, true);
      const iso = `${key}-${String(day).padStart(2, "0")}`;
      const labels = dayEvents.map(event => `${event.label}: ${money(event.amount)}`).join("; ");
      const dots = dayEvents.slice(0, 8).map(event => `<i class="calendar-dot calendar-dot--${escapeHTML(event.type)}"></i>`).join("");
      cells += `<div class="calendar-cell ${iso === todayISO() ? "is-today" : ""}" role="gridcell" aria-label="${escapeHTML(`${iso}. ${labels || "No events"}. Running balance ${money(running)}.`)}"><span class="calendar-day">${day}</span>${dayEvents.length ? `<span class="calendar-total ${total >= 0 ? "is-positive" : "is-negative"}" title="${escapeHTML(money(total))}">${compactMoney(total)}</span><span class="calendar-dots" aria-hidden="true">${dots}</span>` : ""}<span class="calendar-running">Bal ${compactMoney(running).replace(/^\+/, "")}</span></div>`;
    }

    return {
      key,
      cells,
      openingBalance,
      closingBalance: roundMoney(running, 0, true),
      net: roundMoney(running - openingBalance, 0, true),
      financial,
      goalFundingApplied,
      monthTransactions,
      postedExpenseTotal: roundMoney(monthTransactions.reduce((sum, transaction) => sum + transaction.amount, 0)),
      upcomingRecurringTotal: roundMoney(recurring.filter(item => !postedRecurringIds.has(item.id)).reduce((sum, item) => sum + item.amount, 0)),
      scheduledCount: recurring.filter(item => !postedRecurringIds.has(item.id)).length
    };
  }

  function renderCalendar() {
    const key = monthKeyAtOffset(ui.calendarOffset);
    const result = buildCalendar(key);
    byId("calendarMonthLabel").textContent = monthFormatter.format(monthDate(key));
    byId("calendarOpeningBalance").value = String(result.openingBalance);
    byId("calendarClosingBalance").textContent = money(result.closingBalance);
    byId("calendarClosingBalance").className = result.closingBalance < 0 ? "danger-text" : "good-text";
    const net = byId("calendarNet");
    net.textContent = `NET ${money(result.net)}`;
    net.className = `status-chip ${result.net < 0 ? "status-chip--danger" : "status-chip--good"}`;
    byId("calendarGrid").innerHTML = result.cells;
    byId("calendarNote").textContent = `Opening ${money(result.openingBalance)} · Posted expenses ${money(result.postedExpenseTotal)} (${result.monthTransactions.length}) · Upcoming recurring ${money(result.upcomingRecurringTotal)} (${result.scheduledCount}) · Goal Funding ${money(result.goalFundingApplied)}. Income source: ${result.financial.source}.`;
  }

  function saveOpeningBalance() {
    const key = monthKeyAtOffset(ui.calendarOffset);
    state.calendarOpeningBalances[key] = roundMoney(byId("calendarOpeningBalance").value, 0, true);
    const saved = persist();
    renderCalendar();
    showPersistenceToast("Opening balance updated", saved);
  }

  function openCloseDraft(key) {
    const snapshot = state.closedMonths[key];
    if (snapshot) {
      return {
        key,
        baseNetIncome: snapshot.baseNetIncome,
        actualOtIncome: snapshot.actualOtIncome,
        monthlyExpense: snapshot.monthlyExpense,
        actualSaving: snapshot.actualSaving,
        actualInvestment: snapshot.actualInvestment,
        planFreeCash: snapshot.planFreeCash,
        goalFundingApplied: snapshot.goalFundingApplied,
        availableFreeCash: snapshot.availableFreeCash,
        closingBalance: snapshot.closingBalance,
        calendarProjectedBalance: snapshot.calendarProjectedBalance,
        salaryDay: snapshot.salaryDay,
        manualHistorical: snapshot.snapshotType === "historical-manual",
        snapshot
      };
    }
    const isCurrent = key === currentMonthKey();
    const manualHistorical = key < currentMonthKey() && ui.historicalBackfillKey === key;
    const baseNetIncome = isCurrent ? state.settings.baseNetIncome : 0;
    const actualOtIncome = isCurrent ? otForMonth(key).actualEarned : 0;
    const monthlyExpense = isCurrent ? plannedMonthlyExpense() : 0;
    const actualSaving = isCurrent ? state.settings.savingGoal : 0;
    const actualInvestment = isCurrent ? state.settings.investmentGoal : 0;
    const goalFundingApplied = isCurrent ? goalFundingAppliedForMonth(key) : 0;
    const planFreeCash = baseNetIncome + actualOtIncome - monthlyExpense - actualSaving - actualInvestment;
    const salaryDay = state.settings.salaryDay;
    const calendar = buildCalendar(key, { baseIncome: baseNetIncome, actualOt: actualOtIncome, salaryDay, goalFundingApplied, source: "monthly close review" });
    return {
      key,
      baseNetIncome,
      actualOtIncome,
      monthlyExpense,
      actualSaving,
      actualInvestment,
      planFreeCash,
      goalFundingApplied,
      availableFreeCash: planFreeCash - goalFundingApplied,
      closingBalance: null,
      calendarProjectedBalance: calendar.closingBalance,
      salaryDay,
      manualHistorical,
      snapshot: null
    };
  }

  function closeDraftFromInputs(options = {}) {
    const key = monthKeyAtOffset(ui.closeOffset);
    const original = openCloseDraft(key);
    const reopened = original.snapshot?.status === "reopened";
    const manualHistorical = key < currentMonthKey() && !original.snapshot && ui.historicalBackfillKey === key;
    if (key !== currentMonthKey() && !reopened && !manualHistorical) throw new Error("Start a manual historical snapshot before entering past-month values.");
    const requiredIds = manualHistorical ? ["closeBaseIncomeInput", "closeOtIncomeInput", "closeExpenseInput", "closeActualSaving", "closeActualInvestment", "closeGoalFundingInput", "closeSalaryDayInput", "closeBalanceInput"] : [];
    if (options.requireComplete && requiredIds.some(id => byId(id).value.trim() === "")) throw new Error("Complete every manual historical field, including Actual Closing Cash Balance.");
    const baseNetIncome = roundMoney(byId("closeBaseIncomeInput").value);
    const actualOtIncome = roundMoney(byId("closeOtIncomeInput").value);
    const actualSaving = roundMoney(byId("closeActualSaving").value);
    const actualInvestment = roundMoney(byId("closeActualInvestment").value);
    const salaryDay = wholeNumber(byId("closeSalaryDayInput").value, original.salaryDay, 1, 28);
    const monthlyExpense = manualHistorical ? roundMoney(byId("closeExpenseInput").value) : original.monthlyExpense;
    const activeCycle = activeGoalFundingCycle(key);
    const goalFundingApplied = manualHistorical ? roundMoney(byId("closeGoalFundingInput").value) : key === currentMonthKey()
      ? amount(activeCycle?.appliedAmount)
      : activeCycle ? amount(activeCycle.appliedAmount) : amount(original.goalFundingApplied);
    const finance = calculateFinance({ key, baseNetIncome, actualOtIncome, monthlyExpense, savingGoal: actualSaving, investmentGoal: actualInvestment, goalFundingApplied });
    const calendar = buildCalendar(key, { baseIncome: baseNetIncome, actualOt: actualOtIncome, salaryDay, goalFundingApplied, source: "monthly close review" });
    const closingRaw = byId("closeBalanceInput").value.trim();
    return {
      key,
      baseNetIncome,
      actualOtIncome,
      monthlyIncome: finance.monthlyIncome,
      monthlyExpense,
      actualSaving,
      actualInvestment,
      planFreeCash: finance.planFreeCash,
      goalFundingApplied,
      availableFreeCash: finance.availableFreeCash,
      closingBalance: closingRaw === "" ? null : roundMoney(closingRaw, 0, true),
      calendarProjectedBalance: calendar.closingBalance,
      salaryDay,
      manualHistorical,
      originalSnapshot: original.snapshot
    };
  }

  function snapshotAuditData(snapshot) {
    return {
      baseNetIncome: snapshot.baseNetIncome,
      actualOtIncome: snapshot.actualOtIncome,
      monthlyExpense: snapshot.monthlyExpense,
      actualSaving: snapshot.actualSaving,
      actualInvestment: snapshot.actualInvestment,
      planFreeCash: snapshot.planFreeCash,
      goalFundingApplied: snapshot.goalFundingApplied,
      availableFreeCash: snapshot.availableFreeCash,
      closingBalance: snapshot.closingBalance,
      calendarProjectedBalance: snapshot.calendarProjectedBalance,
      salaryDay: snapshot.salaryDay
    };
  }

  function renderCloseMonth() {
    const key = monthKeyAtOffset(ui.closeOffset);
    const draft = openCloseDraft(key);
    const isClosed = isClosedSnapshot(draft.snapshot);
    const isReopened = draft.snapshot?.status === "reopened";
    const isCurrent = key === currentMonthKey();
    const manualHistorical = key < currentMonthKey() && !draft.snapshot && ui.historicalBackfillKey === key;
    const canEdit = isCurrent || isReopened || manualHistorical;
    byId("closeMonthLabel").textContent = monthFormatter.format(monthDate(key));
    byId("closeBaseIncomeInput").value = manualHistorical ? "" : String(draft.baseNetIncome);
    byId("closeOtIncomeInput").value = manualHistorical ? "" : String(draft.actualOtIncome);
    byId("closeExpenseInput").value = manualHistorical ? "" : String(draft.monthlyExpense);
    byId("closeGoalFundingInput").value = manualHistorical ? "" : String(draft.goalFundingApplied);
    byId("closeExpenseField").hidden = !manualHistorical;
    byId("closeGoalFundingField").hidden = !manualHistorical;
    byId("closeExpense").textContent = money(draft.monthlyExpense);
    byId("closePlanFreeCash").textContent = money(draft.planFreeCash);
    byId("closeGoalFundingApplied").textContent = money(draft.goalFundingApplied);
    byId("closeAvailableFreeCash").textContent = money(draft.availableFreeCash);
    byId("closeAvailableFreeCash").className = draft.availableFreeCash < 0 ? "danger-text" : "good-text";
    byId("closeCalendarProjected").textContent = draft.calendarProjectedBalance == null ? "—" : money(draft.calendarProjectedBalance);
    byId("closeActualSaving").value = manualHistorical ? "" : String(draft.actualSaving);
    byId("closeActualInvestment").value = manualHistorical ? "" : String(draft.actualInvestment);
    byId("closeSalaryDayInput").value = manualHistorical ? "" : String(draft.salaryDay);
    byId("closeBalanceInput").value = draft.closingBalance === null ? "" : String(draft.closingBalance);
    ["closeBaseIncomeInput", "closeOtIncomeInput", "closeExpenseInput", "closeGoalFundingInput", "closeActualSaving", "closeActualInvestment", "closeSalaryDayInput", "closeBalanceInput"].forEach(id => { byId(id).disabled = !canEdit || isClosed; });
    byId("closeMonthButton").hidden = !canEdit || isClosed;
    byId("closeMonthButton").disabled = !canEdit || isClosed;
    byId("closeMonthButton").textContent = manualHistorical ? "Review & Save Historical Snapshot" : isReopened ? "Review & Reclose Month" : "Review & Close Month";
    byId("reopenMonthButton").hidden = !isClosed;
    byId("historicalBackfillButton").hidden = isCurrent || Boolean(draft.snapshot) || manualHistorical;
    byId("copyCurrentPlanButton").hidden = !manualHistorical;
    const status = byId("closeStatus");
    status.textContent = isClosed ? (draft.snapshot.snapshotType === "historical-manual" ? "MANUAL HISTORICAL SNAPSHOT" : "CLOSED") : isReopened ? "REOPENED" : manualHistorical ? "MANUAL INPUT" : isCurrent ? "OPEN" : "UNAVAILABLE";
    status.className = `status-chip ${isClosed ? "status-chip--good" : canEdit ? "status-chip--amber" : ""}`;
    byId("closeNote").textContent = isClosed
      ? `Revision ${draft.snapshot.revision} closed ${dateFormatter.format(new Date(draft.snapshot.closedAt))}. Reopen records the frozen values before correction.`
      : isReopened ? `Correction open: ${draft.snapshot.reopenReason}. Review is required to freeze revision ${draft.snapshot.revision + 1}.`
      : manualHistorical ? "Enter verified historical values manually. Nothing is inferred; Copy Current Plan is an explicit convenience only. Review creates revision 1."
      : isCurrent ? "Edit actual income if needed, then complete the required review before freezing." : "Historical months without a snapshot are not synthesized from today’s settings. Create a manual historical snapshot if you have verified records.";

    const auditTrail = draft.snapshot?.auditTrail || [];
    byId("closeRevision").textContent = draft.snapshot ? `REVISION ${draft.snapshot.revision}` : "NO REVISION";
    byId("closeAuditList").innerHTML = auditTrail.length ? [...auditTrail].reverse().map(entry => `<article class="record-card"><div class="record-main"><span class="category-icon" aria-hidden="true">${entry.event === "reopened" ? "↶" : "□"}</span><div class="record-copy"><h2 class="record-title">${entry.event === "reopened" ? "Reopened for correction" : entry.event === "historical-backfill" ? "Manual historical snapshot" : "Snapshot frozen"}</h2><div class="record-meta"><span>Revision ${entry.revision}</span><span>${escapeHTML(dateFormatter.format(new Date(entry.at)))}</span>${entry.reason ? `<span>${escapeHTML(entry.reason)}</span>` : ""}</div></div></div><div class="record-side"><span class="status-chip ${entry.event === "closed" ? "status-chip--good" : "status-chip--amber"}">${escapeHTML(entry.event.toUpperCase())}</span></div></article>`).join("") : emptyState("□", "No audit entries", "The first confirmed close creates revision 1.");

    const closedItems = Object.values(state.closedMonths).sort((a, b) => b.key.localeCompare(a.key));
    byId("closedMonthList").innerHTML = closedItems.length ? closedItems.map(item => `<article class="record-card"><div class="record-main"><span class="category-icon" aria-hidden="true">□</span><div class="record-copy"><h2 class="record-title">${escapeHTML(monthFormatter.format(monthDate(item.key)))}</h2><div class="record-meta"><span>Income ${money(item.monthlyIncome)}</span><span>Expense ${money(item.monthlyExpense)}</span><span>OT ${money(item.actualOtIncome)}</span><span>Plan Free Cash ${money(item.planFreeCash)}</span><span>Goal Funding ${money(item.goalFundingApplied)}</span></div></div></div><div class="record-side"><strong class="record-amount ${item.availableFreeCash < 0 ? "danger-text" : "good-text"}">${money(item.availableFreeCash)}</strong><span class="status-chip ${item.status === "reopened" ? "status-chip--amber" : "status-chip--good"}">${item.status === "reopened" ? "REOPENED" : item.snapshotType === "historical-manual" ? `MANUAL R${item.revision}` : `CLOSED R${item.revision}`}</span></div></article>`).join("") : emptyState("□", "No closed months", "Close the active month to begin verified trend history.");
  }

  function previewCloseInputs() {
    const draft = closeDraftFromInputs();
    byId("closeExpense").textContent = money(draft.monthlyExpense);
    byId("closePlanFreeCash").textContent = money(draft.planFreeCash);
    byId("closeGoalFundingApplied").textContent = money(draft.goalFundingApplied);
    byId("closeAvailableFreeCash").textContent = money(draft.availableFreeCash);
    byId("closeAvailableFreeCash").className = draft.availableFreeCash < 0 ? "danger-text" : "good-text";
    byId("closeCalendarProjected").textContent = money(draft.calendarProjectedBalance);
  }

  function startHistoricalBackfill() {
    const key = monthKeyAtOffset(ui.closeOffset);
    if (key >= currentMonthKey() || state.closedMonths[key]) throw new Error("Manual historical backfill is available only for a past month without a snapshot.");
    ui.historicalBackfillKey = key;
    renderCloseMonth();
    requestAnimationFrame(() => byId("closeBaseIncomeInput").focus());
  }

  function copyCurrentPlanToHistoricalDraft() {
    const key = monthKeyAtOffset(ui.closeOffset);
    if (ui.historicalBackfillKey !== key || state.closedMonths[key]) throw new Error("Start a manual historical snapshot first.");
    const finance = calculateFinance();
    byId("closeBaseIncomeInput").value = String(finance.baseNetIncome);
    byId("closeOtIncomeInput").value = String(finance.actualOtIncome);
    byId("closeExpenseInput").value = String(finance.monthlyExpense);
    byId("closeActualSaving").value = String(finance.savingGoal);
    byId("closeActualInvestment").value = String(finance.investmentGoal);
    byId("closeGoalFundingInput").value = String(finance.goalFundingApplied);
    byId("closeSalaryDayInput").value = String(state.settings.salaryDay);
    previewCloseInputs();
    showToast("Current plan copied into the draft; verify every historical value before review");
  }

  function sixMonthKeys() {
    const keys = [];
    for (let offset = -5; offset <= 0; offset += 1) keys.push(monthKeyAtOffset(offset));
    return keys;
  }

  function renderTrend() {
    const rows = sixMonthKeys().map(key => summaryForMonth(key));
    const max = Math.max(1, ...rows.flatMap(row => row ? [row.monthlyIncome, row.monthlyExpense] : [0]));
    byId("trendChart").innerHTML = rows.map((row, index) => {
      const key = sixMonthKeys()[index];
      const incomeHeight = row ? Math.max(1, (row.monthlyIncome / max) * 100) : 0;
      const expenseHeight = row ? Math.max(1, (row.monthlyExpense / max) * 100) : 0;
      return `<div class="trend-column" title="${escapeHTML(row ? `${money(row.monthlyIncome)} income, ${money(row.monthlyExpense)} expense` : "No closed snapshot")}"><div class="trend-bars"><i class="trend-bar" style="height:${incomeHeight}%"></i><i class="trend-bar trend-bar--expense" style="height:${expenseHeight}%"></i></div><span>${escapeHTML(shortMonthFormatter.format(monthDate(key)))}</span></div>`;
    }).join("");
    byId("trendChart").setAttribute("aria-label", `Six month chart. ${rows.filter(Boolean).length} month${rows.filter(Boolean).length === 1 ? "" : "s"} have verified data.`);
    byId("trendTableBody").innerHTML = rows.map((row, index) => {
      const key = sixMonthKeys()[index];
      if (!row) return `<tr><td data-label="Month">${escapeHTML(monthFormatter.format(monthDate(key)))}</td><td data-label="Income">—</td><td data-label="Expense">—</td><td data-label="OT">—</td><td data-label="Plan Free Cash">—</td><td data-label="Goal Funding">—</td><td data-label="Available Free Cash">—</td><td data-label="Saving Rate">—</td><td data-label="Source"><span class="status-chip">NO SNAPSHOT</span></td></tr>`;
      return `<tr><td data-label="Month">${escapeHTML(monthFormatter.format(monthDate(key)))}</td><td data-label="Income">${money(row.monthlyIncome)}</td><td data-label="Expense">${money(row.monthlyExpense)}</td><td data-label="OT">${money(row.actualOtIncome)}</td><td data-label="Plan Free Cash" class="${row.planFreeCash < 0 ? "danger-text" : "good-text"}">${money(row.planFreeCash)}</td><td data-label="Goal Funding">${money(row.goalFundingApplied)}</td><td data-label="Available Free Cash" class="${row.availableFreeCash < 0 ? "danger-text" : "good-text"}">${money(row.availableFreeCash)}</td><td data-label="Saving Rate">${percent(row.savingRate, 1)}</td><td data-label="Source"><span class="status-chip ${row.source === "CLOSED" ? "status-chip--good" : "status-chip--amber"}">${row.source}</span></td></tr>`;
    }).join("");
  }

  function renderCategories() {
    const linkedCount = new Map();
    state.transactions.forEach(transaction => linkedCount.set(transaction.categoryId, (linkedCount.get(transaction.categoryId) || 0) + 1));
    byId("categoryManagerList").innerHTML = state.categories.map(category => {
      const linkedTransactions = linkedCount.get(category.id) || 0;
      const locked = category.id === "other";
      return `<article class="record-card"><div class="record-main"><span class="category-icon" aria-hidden="true">${escapeHTML(category.icon)}</span><div class="record-copy"><h2 class="record-title">${escapeHTML(category.name)}</h2><div class="record-meta"><span>${money(category.monthlyAmount)} monthly</span><span>${linkedTransactions} transaction${linkedTransactions === 1 ? "" : "s"}</span>${locked ? "<span>Required fallback</span>" : ""}</div></div></div><div class="record-side"><strong class="record-amount">${money(category.monthlyAmount)}</strong><div class="record-actions"><button type="button" class="button button--secondary" data-action="edit-category" data-id="${escapeHTML(category.id)}">Edit</button>${locked ? "" : `<button type="button" class="button button--danger" data-action="delete-category" data-id="${escapeHTML(category.id)}">Delete</button>`}</div></div></article>`;
    }).join("");
  }

  function renderSettings() {
    byId("settingBaseIncome").value = String(state.settings.baseNetIncome);
    byId("settingEmergencyFund").value = String(state.settings.emergencyFund);
    byId("settingSavingGoal").value = String(state.settings.savingGoal);
    byId("settingInvestmentGoal").value = String(state.settings.investmentGoal);
    byId("settingSalaryDay").value = String(state.settings.salaryDay);
    byId("settingOtFundingEnabled").checked = state.allocationRules.otEnabled;
    byId("settingOtPercent").value = String(state.allocationRules.otPercent);
    byId("settingSurplusPercent").value = String(state.allocationRules.surplusPercent);
    byId("settingFundingThreshold").value = String(state.allocationRules.threshold);
    byId("lastFullBackup").textContent = state.meta.lastFullBackupAt ? dateFormatter.format(new Date(state.meta.lastFullBackupAt)) : "Never";
    renderRuntimeStatus();
  }

  function renderRuntimeStatus() {
    const dataStatus = document.getElementById("localDataStatus");
    const connectionStatus = document.getElementById("connectionStatus");
    const installButton = document.getElementById("installAppButton");
    const storageWarning = document.getElementById("storageWarning");
    const updateBanner = document.getElementById("updateBanner");
    if (dataStatus) {
      dataStatus.textContent = runtime.storageMessage;
      dataStatus.className = runtime.storageAvailable ? "good-text" : "warn-text";
    }
    if (connectionStatus) {
      connectionStatus.textContent = `${navigator.onLine ? "Online" : "Offline"} · ${runtime.serviceWorkerMessage}`;
      connectionStatus.className = runtime.serviceWorkerReady ? "good-text" : "warn-text";
    }
    if (installButton) {
      const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
      installButton.disabled = standalone;
      installButton.textContent = standalone ? "Installed" : runtime.deferredInstallPrompt ? "Install PWA" : "Install via Browser";
    }
    if (storageWarning) storageWarning.hidden = runtime.storageAvailable;
    if (updateBanner) updateBanner.hidden = !runtime.updateRegistration?.waiting;
  }

  const renderers = {
    dashboard: renderDashboard,
    "monthly-expense": renderMonthlyExpense,
    ot: renderOT,
    "buy-check": renderBuyCheck,
    transactions: renderTransactions,
    recurring: renderRecurring,
    goals: renderGoals,
    calendar: renderCalendar,
    "monthly-close": renderCloseMonth,
    trend: renderTrend,
    categories: renderCategories,
    settings: renderSettings,
    more: () => {}
  };

  function renderActiveView() {
    const renderer = renderers[ui.activeView];
    if (!renderer) throw new Error(`No renderer is registered for ${ui.activeView}.`);
    renderer();
  }

  function renderApp() {
    updateNavigation();
    renderActiveView();
    renderRuntimeStatus();
  }

  function openDialog(dialogId, mode, itemId = "") {
    const dialog = byId(dialogId);
    if (!(dialog instanceof HTMLDialogElement)) throw new Error(`${dialogId} is not a valid dialog.`);
    clearFormError(dialog.querySelector("form"));
    if (dialogId === "transactionDialog") {
      const item = state.transactions.find(transaction => transaction.id === itemId);
      byId("transactionDialogTitle").textContent = item ? "Edit Transaction" : "Add Transaction";
      byId("transactionId").value = item?.id || "";
      byId("transactionName").value = item?.name || "";
      byId("transactionAmount").value = item ? String(item.amount) : "";
      byId("transactionDate").value = item?.date || todayISO();
      fillCategoryOptions(byId("transactionCategory"), item?.categoryId || "other");
      byId("transactionRecurringTag").checked = Boolean(item?.recurringTag);
    } else if (dialogId === "recurringDialog") {
      const item = state.recurring.find(recurring => recurring.id === itemId);
      byId("recurringDialogTitle").textContent = item ? "Edit Recurring" : "Add Recurring";
      byId("recurringId").value = item?.id || "";
      byId("recurringName").value = item?.name || "";
      byId("recurringAmount").value = item ? String(item.amount) : "";
      byId("recurringDay").value = item ? String(item.day) : String(clamp(Number(todayISO().slice(-2)), 1, 28));
      fillCategoryOptions(byId("recurringCategory"), item?.categoryId || "other");
      byId("recurringActive").checked = item?.active !== false;
    } else if (dialogId === "goalDialog") {
      const item = state.goals.find(goal => goal.id === itemId);
      if (item && activeFundingForGoal(item.id) > 0) throw new Error("Undo current-month Goal Funding before editing a funded goal.");
      byId("goalDialogTitle").textContent = item ? "Edit Goal" : "Add Goal";
      byId("goalId").value = item?.id || "";
      byId("goalName").value = item?.name || "";
      byId("goalCurrent").value = item ? String(item.currentAmount) : "0";
      byId("goalTarget").value = item ? String(item.target) : "";
      byId("goalAllocation").value = item ? String(item.allocationPercent) : "0";
    } else if (dialogId === "categoryDialog") {
      const item = state.categories.find(category => category.id === itemId);
      byId("categoryDialogTitle").textContent = item ? "Edit Category" : "Add Category";
      byId("categoryId").value = item?.id || "";
      byId("categoryName").value = item?.name || "";
      byId("categoryIcon").value = item?.icon || "";
      byId("categoryAmount").value = item ? String(item.monthlyAmount) : "0";
    }
    dialog.dataset.mode = mode;
    showDialog(dialog, dialog.querySelector("input:not([type='hidden']), select"));
  }

  function closeDialogFrom(control) {
    const dialog = control.closest("dialog");
    if (dialog?.id === "closeReviewDialog") ui.pendingCloseDraft = null;
    if (dialog?.id === "reopenDialog") ui.pendingReopenKey = null;
    if (dialog?.id === "confirmationDialog") ui.pendingConfirmation = null;
    if (dialog?.id === "importReviewDialog") ui.pendingImport = null;
    if (dialog?.open) dialog.close();
  }

  function showDialog(dialog, focusTarget) {
    clearFormError(dialog.querySelector("form"));
    ui.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    requestAnimationFrame(() => (focusTarget || dialog.querySelector("input:not([type='hidden']), select, button"))?.focus());
  }

  function requestConfirmation(kind, id = "") {
    let title = "Confirm action";
    let copy = "Review the result before continuing.";
    let label = "Confirm";
    if (kind === "delete-transaction") {
      const item = state.transactions.find(transaction => transaction.id === id);
      if (!item) throw new Error("Transaction not found.");
      title = "Delete Transaction";
      copy = `Delete “${item.name}” for ${money(item.amount)}? This removes only this history record and does not change Monthly Expense planning.`;
      label = "Delete Transaction";
    } else if (kind === "delete-recurring") {
      const item = state.recurring.find(recurring => recurring.id === id);
      if (!item) throw new Error("Recurring expense not found.");
      title = "Delete Recurring Expense";
      copy = `Delete “${item.name}”? Existing paid transactions remain in history and Monthly Expense planning is unchanged.`;
      label = "Delete Recurring";
    } else if (kind === "delete-goal") {
      const item = state.goals.find(goal => goal.id === id);
      if (!item) throw new Error("Goal not found.");
      if (activeFundingForGoal(id) > 0) throw new Error("Undo current-month Goal Funding before deleting this funded goal.");
      title = "Delete Goal";
      copy = `Delete “${item.name}”? Its goal balance and allocation will be removed. Funding audit records remain.`;
      label = "Delete Goal";
    } else if (kind === "delete-category") {
      const item = state.categories.find(category => category.id === id);
      if (!item) throw new Error("Category not found.");
      if (id === "other") throw new Error("Other is the required fallback category and cannot be deleted.");
      title = "Delete Category";
      copy = `Delete “${item.name}”? Linked transactions will move to Other and keep the old label; recurring items move to Other.`;
      label = "Delete Category";
    } else if (kind === "pay-recurring") {
      const item = state.recurring.find(recurring => recurring.id === id);
      if (!item) throw new Error("Recurring expense not found.");
      title = "Mark Recurring Expense Paid";
      copy = `Create one ${money(item.amount)} transaction for “${item.name}” this month? The Monthly Expense plan will not change.`;
      label = "Create Paid Transaction";
    } else if (kind === "undo-goal-funding") {
      const cycle = activeGoalFundingCycle();
      if (!cycle) throw new Error("There is no active Goal Funding to undo this month.");
      title = "Undo Goal Funding";
      copy = `Reverse ${money(cycle.appliedAmount)} from goal balances and restore the same amount to Available Free Cash? The funding cycle remains in the audit as UNDONE.`;
      label = "Undo Funding";
    } else if (kind === "recalculate-goal-funding") {
      const cycle = activeGoalFundingCycle();
      if (!cycle || !fundingBasisChanged(cycle)) throw new Error("The active Goal Funding plan has not changed.");
      title = "Undo & Recalculate Funding";
      copy = `Reverse the active ${money(cycle.appliedAmount)} allocation, then calculate and apply one replacement cycle from the current plan. Both cycles remain in the audit.`;
      label = "Undo & Recalculate";
    } else throw new Error("Unknown confirmation action.");
    ui.pendingConfirmation = { kind, id };
    byId("confirmationDialogTitle").textContent = title;
    byId("confirmationDialogCopy").textContent = copy;
    byId("confirmationSubmit").textContent = label;
    byId("confirmationSubmit").disabled = false;
    showDialog(byId("confirmationDialog"), byId("confirmationSubmit"));
  }

  function commitConfirmation() {
    if (runtime.destructiveBusy) return;
    const pending = ui.pendingConfirmation;
    if (!pending) throw new Error("The confirmation expired. Start the action again.");
    runtime.destructiveBusy = true;
    byId("confirmationSubmit").disabled = true;
    try {
      if (pending.kind === "delete-transaction") deleteTransaction(pending.id);
      else if (pending.kind === "delete-recurring") deleteRecurring(pending.id);
      else if (pending.kind === "delete-goal") deleteGoal(pending.id);
      else if (pending.kind === "delete-category") deleteCategory(pending.id);
      else if (pending.kind === "pay-recurring") payRecurring(pending.id);
      else if (pending.kind === "undo-goal-funding") undoGoalFunding();
      else if (pending.kind === "recalculate-goal-funding") recalculateGoalFunding();
      else throw new Error("Unknown confirmation action.");
      ui.pendingConfirmation = null;
      byId("confirmationDialog").close();
    } finally {
      runtime.destructiveBusy = false;
      if (byId("confirmationDialog").open) byId("confirmationSubmit").disabled = false;
    }
  }

  function saveTransaction() {
    const id = byId("transactionId").value;
    const existing = state.transactions.find(transaction => transaction.id === id);
    const name = cleanText(byId("transactionName").value, "", 80);
    const transactionAmount = roundMoney(byId("transactionAmount").value);
    const date = byId("transactionDate").value;
    const categoryId = byId("transactionCategory").value;
    if (!name) throw new Error("Enter a transaction description.");
    if (transactionAmount <= 0) throw new Error("Transaction amount must be greater than zero.");
    if (!isISODate(date)) throw new Error("Choose a valid transaction date.");
    if (!state.categories.some(category => category.id === categoryId)) throw new Error("Choose a valid category.");
    if (existing?.recurringId && state.transactions.some(transaction => transaction.id !== existing.id && transaction.recurringId === existing.recurringId && transaction.date.slice(0, 7) === date.slice(0, 7))) {
      throw new Error("That recurring item already has a paid transaction in the selected month.");
    }
    const record = {
      id: existing?.id || uid("transaction"),
      name,
      amount: transactionAmount,
      categoryId,
      categoryLabel: categoryById(categoryId)?.name || "Other",
      date,
      recurringId: existing?.recurringId || null,
      recurringTag: Boolean(byId("transactionRecurringTag").checked || existing?.recurringId),
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    if (existing) Object.assign(existing, record);
    else state.transactions.push(record);
    const saved = persist();
    byId("transactionDialog").close();
    renderActiveView();
    showPersistenceToast(existing ? "Transaction updated" : "Transaction added", saved);
  }

  function saveRecurring() {
    const id = byId("recurringId").value;
    const existing = state.recurring.find(item => item.id === id);
    const name = cleanText(byId("recurringName").value, "", 80);
    const recurringAmount = roundMoney(byId("recurringAmount").value);
    const day = wholeNumber(byId("recurringDay").value, 0, 1, 28);
    const categoryId = byId("recurringCategory").value;
    if (!name) throw new Error("Enter a recurring expense name.");
    if (recurringAmount <= 0) throw new Error("Recurring amount must be greater than zero.");
    if (day < 1 || day > 28) throw new Error("Due day must be between 1 and 28.");
    if (!state.categories.some(category => category.id === categoryId)) throw new Error("Choose a valid category.");
    const record = {
      id: existing?.id || uid("recurring"),
      name,
      amount: recurringAmount,
      day,
      categoryId,
      active: byId("recurringActive").checked,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    if (existing) Object.assign(existing, record);
    else state.recurring.push(record);
    const saved = persist();
    byId("recurringDialog").close();
    renderActiveView();
    showPersistenceToast(existing ? "Recurring expense updated" : "Recurring expense added", saved);
  }

  function saveGoal() {
    const id = byId("goalId").value;
    const existing = state.goals.find(goal => goal.id === id);
    const name = cleanText(byId("goalName").value, "", 80);
    const target = roundMoney(byId("goalTarget").value);
    const currentAmount = roundMoney(byId("goalCurrent").value);
    const allocationPercent = clamp(amount(byId("goalAllocation").value), 0, 100);
    if (existing && activeFundingForGoal(existing.id) > 0) throw new Error("Undo current-month Goal Funding before editing this funded goal.");
    if (!name) throw new Error("Enter a goal name.");
    if (target <= 0) throw new Error("Goal target must be greater than zero.");
    if (currentAmount > target) throw new Error("Current Amount cannot exceed the goal target.");
    const otherAllocation = state.goals.filter(goal => goal.id !== id).reduce((sum, goal) => sum + goal.allocationPercent, 0);
    if (otherAllocation + allocationPercent > 100) throw new Error("Goal allocation percentages cannot exceed 100% in total.");
    const record = {
      id: existing?.id || uid("goal"),
      name,
      currentAmount,
      target,
      allocationPercent,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    if (existing) Object.assign(existing, record);
    else state.goals.push(record);
    const saved = persist();
    byId("goalDialog").close();
    renderActiveView();
    showPersistenceToast(existing ? "Goal updated" : "Goal added", saved);
  }

  function saveCategory() {
    const id = byId("categoryId").value;
    const existing = state.categories.find(category => category.id === id);
    const name = cleanText(byId("categoryName").value, "", 60);
    const icon = cleanText(byId("categoryIcon").value, "•", 4);
    const monthlyAmount = roundMoney(byId("categoryAmount").value);
    if (!name) throw new Error("Enter a category name.");
    if (state.categories.some(category => category.id !== id && category.name.toLowerCase() === name.toLowerCase())) throw new Error("A category with that name already exists.");
    if (existing) {
      existing.name = existing.id === "other" ? "Other" : name;
      existing.icon = icon;
      existing.monthlyAmount = monthlyAmount;
    } else {
      const used = new Set(state.categories.map(category => category.id));
      state.categories.push({ id: uniqueId(name, used, "category"), name, icon, monthlyAmount });
    }
    const saved = persist();
    byId("categoryDialog").close();
    renderActiveView();
    showPersistenceToast(existing ? "Category updated" : "Category added", saved);
  }

  function saveCategoryPlan(id) {
    const category = state.categories.find(item => item.id === id);
    const input = document.querySelector(`.monthly-expense-input[data-category-id="${CSS.escape(id)}"]`);
    if (!category || !input) throw new Error("The selected category is unavailable.");
    category.monthlyAmount = roundMoney(input.value);
    const saved = persist();
    renderActiveView();
    showPersistenceToast(`${category.name} updated to ${money(category.monthlyAmount)}`, saved);
  }

  function saveOT() {
    const target = roundMoney(byId("otTargetInput").value);
    const actualEarned = roundMoney(byId("otActualInput").value);
    state.otByMonth[currentMonthKey()] = { target, actualEarned, updatedAt: new Date().toISOString() };
    const saved = persist();
    renderActiveView();
    showPersistenceToast("OT values updated across the app", saved);
  }

  function saveSettings() {
    const otPercent = amount(byId("settingOtPercent").value);
    const surplusPercent = amount(byId("settingSurplusPercent").value);
    if (otPercent > 100 || surplusPercent > 100) throw new Error("Funding rule percentages must be between 0% and 100%.");
    state.settings = {
      baseNetIncome: roundMoney(byId("settingBaseIncome").value),
      emergencyFund: roundMoney(byId("settingEmergencyFund").value),
      savingGoal: roundMoney(byId("settingSavingGoal").value),
      investmentGoal: roundMoney(byId("settingInvestmentGoal").value),
      salaryDay: wholeNumber(byId("settingSalaryDay").value, state.settings.salaryDay, 1, 28)
    };
    state.allocationRules = {
      otEnabled: byId("settingOtFundingEnabled").checked,
      otPercent,
      surplusPercent,
      threshold: roundMoney(byId("settingFundingThreshold").value)
    };
    const saved = persist();
    renderActiveView();
    showPersistenceToast("Settings updated", saved);
  }

  function deleteTransaction(id) {
    const item = state.transactions.find(transaction => transaction.id === id);
    if (!item) throw new Error("Transaction not found.");
    state.transactions = state.transactions.filter(transaction => transaction.id !== id);
    const saved = persist();
    renderActiveView();
    showPersistenceToast("Transaction deleted", saved);
  }

  function deleteRecurring(id) {
    const item = state.recurring.find(recurring => recurring.id === id);
    if (!item) throw new Error("Recurring expense not found.");
    state.recurring = state.recurring.filter(recurring => recurring.id !== id);
    const saved = persist();
    renderActiveView();
    showPersistenceToast("Recurring expense deleted; transaction history preserved", saved);
  }

  function deleteGoal(id) {
    const item = state.goals.find(goal => goal.id === id);
    if (!item) throw new Error("Goal not found.");
    if (activeFundingForGoal(id) > 0) throw new Error("Undo current-month Goal Funding before deleting this funded goal.");
    state.goals = state.goals.filter(goal => goal.id !== id);
    const saved = persist();
    renderActiveView();
    showPersistenceToast("Goal deleted", saved);
  }

  function deleteCategory(id) {
    const category = state.categories.find(item => item.id === id);
    if (!category) throw new Error("Category not found.");
    if (id === "other") throw new Error("Other is the required fallback category and cannot be deleted.");
    for (const transaction of state.transactions) {
      if (transaction.categoryId === id) {
        transaction.categoryLabel = category.name;
        transaction.categoryId = "other";
      }
    }
    for (const item of state.recurring) {
      if (item.categoryId === id) item.categoryId = "other";
    }
    state.categories = state.categories.filter(item => item.id !== id);
    if (ui.transactionCategory === id) ui.transactionCategory = "";
    const saved = persist();
    renderActiveView();
    showPersistenceToast("Category deleted; linked history preserved under Other", saved);
  }

  function payRecurring(id) {
    const item = state.recurring.find(recurring => recurring.id === id);
    if (!item) throw new Error("Recurring expense not found.");
    const key = currentMonthKey();
    if (state.transactions.some(transaction => transaction.recurringId === id && transaction.date.startsWith(key))) {
      showToast("This recurring expense is already paid for the month");
      return;
    }
    state.transactions.push({
      id: uid("transaction"),
      name: item.name,
      amount: item.amount,
      categoryId: item.categoryId,
      categoryLabel: categoryById(item.categoryId)?.name || "Other",
      date: todayISO(),
      recurringId: item.id,
      recurringTag: true,
      createdAt: new Date().toISOString()
    });
    const saved = persist();
    renderActiveView();
    showPersistenceToast(`${item.name} marked paid; Monthly Expense plan unchanged`, saved);
  }

  function balanceGoalAllocations() {
    if (activeGoalFundingCycle()) throw new Error("Undo current-month Goal Funding before changing allocations.");
    const openGoals = state.goals.filter(goal => goal.currentAmount < goal.target);
    if (!openGoals.length) throw new Error("There are no unfinished goals to allocate.");
    state.goals.forEach(goal => { goal.allocationPercent = 0; });
    const baseShare = Math.floor((100 / openGoals.length) * 10) / 10;
    let assigned = 0;
    openGoals.forEach((goal, index) => {
      goal.allocationPercent = index === openGoals.length - 1 ? Number((100 - assigned).toFixed(1)) : baseShare;
      assigned += goal.allocationPercent;
    });
    const saved = persist();
    renderActiveView();
    showPersistenceToast("Goal allocation balanced to 100%", saved);
  }

  function allocateGoalFundingCycle() {
    const key = currentMonthKey();
    if (isClosedSnapshot(state.closedMonths[key])) throw new Error("Reopen the current month before changing Goal Funding.");
    if (activeGoalFundingCycle(key)) throw new Error("Goal funding is already applied. Undo it before applying a replacement.");
    const totalAllocation = state.goals.reduce((sum, goal) => sum + goal.allocationPercent, 0);
    if (totalAllocation <= 0) throw new Error("Set a goal allocation percentage first.");
    if (totalAllocation > 100) throw new Error("Goal allocation percentages exceed 100%.");
    const basis = currentFundingBasis(key);
    const pool = basis.availablePool;
    if (pool <= 0) throw new Error("No funding pool is currently available.");

    const allocations = [];
    let appliedAmount = 0;
    for (const goal of state.goals) {
      const requested = roundMoney(pool * (goal.allocationPercent / 100));
      const room = roundMoney(Math.max(0, goal.target - goal.currentAmount));
      const applied = roundMoney(Math.min(requested, room, roundMoney(pool - appliedAmount)));
      if (applied <= 0) continue;
      const beforeAmount = goal.currentAmount;
      goal.currentAmount = roundMoney(goal.currentAmount + applied);
      appliedAmount = roundMoney(appliedAmount + applied);
      allocations.push({ goalId: goal.id, goalName: goal.name, amount: applied, beforeAmount: roundMoney(beforeAmount), afterAmount: goal.currentAmount });
    }
    if (appliedAmount <= 0) throw new Error("No goal has capacity for the available funding pool.");
    if (!state.allocationHistory[key]) state.allocationHistory[key] = { cycles: [] };
    state.allocationHistory[key].cycles.push({
      id: uid("funding"),
      availablePool: pool,
      appliedAmount,
      allocations,
      appliedAt: new Date().toISOString(),
      status: "applied",
      undoneAt: null,
      undoReason: null,
      legacyBalanceMutation: false,
      basis
    });
    return appliedAmount;
  }

  function applyGoalFunding() {
    const appliedAmount = allocateGoalFundingCycle();
    const saved = persist();
    renderActiveView();
    showToast(saved ? `${money(appliedAmount)} allocated; saved locally` : `${money(appliedAmount)} allocated in memory only`, !saved);
  }

  function reverseGoalFundingCycle(cycle, reason) {
    if (!cycle) throw new Error("There is no active Goal Funding to undo this month.");
    const missingGoal = cycle.allocations.find(allocation => !state.goals.some(goal => goal.id === allocation.goalId));
    if (missingGoal) throw new Error(`Cannot safely undo funding because goal “${missingGoal.goalName || missingGoal.goalId}” is missing.`);
    for (const allocation of cycle.allocations) {
      const goal = state.goals.find(item => item.id === allocation.goalId);
      const expectedAfter = allocation.afterAmount;
      goal.currentAmount = expectedAfter !== null && Math.abs(goal.currentAmount - expectedAfter) < 0.01
        ? roundMoney(allocation.beforeAmount)
        : roundMoney(Math.max(0, goal.currentAmount - roundMoney(allocation.amount)));
    }
    cycle.status = "undone";
    cycle.undoneAt = new Date().toISOString();
    cycle.undoReason = cleanText(reason, "Reset from current-month Goal Funding", 180);
  }

  function undoGoalFunding() {
    const key = currentMonthKey();
    if (isClosedSnapshot(state.closedMonths[key])) throw new Error("Reopen the current month before undoing Goal Funding.");
    const cycle = activeGoalFundingCycle(key);
    reverseGoalFundingCycle(cycle, "Reset from current-month Goal Funding");
    const saved = persist();
    renderActiveView();
    showToast(saved ? `${money(cycle.appliedAmount)} Goal Funding undone; saved locally` : `${money(cycle.appliedAmount)} Goal Funding undone in memory only`, !saved);
  }

  function recalculateGoalFunding() {
    const backup = clone(state);
    const cycle = activeGoalFundingCycle();
    if (!cycle || !fundingBasisChanged(cycle)) throw new Error("The active Goal Funding plan has not changed.");
    try {
      reverseGoalFundingCycle(cycle, "Recalculated after funding basis changed");
      const reapplied = allocateGoalFundingCycle();
      const saved = persist();
      renderActiveView();
      showToast(saved ? `${money(reapplied)} recalculated; saved locally` : `${money(reapplied)} recalculated in memory only`, !saved);
    } catch (error) {
      state = backup;
      throw error;
    }
  }

  function openCloseReview() {
    const key = monthKeyAtOffset(ui.closeOffset);
    const existing = state.closedMonths[key];
    if (isClosedSnapshot(existing)) throw new Error("Reopen this snapshot before making a correction.");
    const manualHistorical = key < currentMonthKey() && !existing && ui.historicalBackfillKey === key;
    if (key !== currentMonthKey() && existing?.status !== "reopened" && !manualHistorical) throw new Error("Start a manual historical snapshot before closing a past month.");
    const draft = closeDraftFromInputs({ requireComplete: true });
    ui.pendingCloseDraft = draft;
    byId("closeReviewDialogTitle").textContent = manualHistorical ? "Review Manual Historical Snapshot" : existing?.status === "reopened" ? "Review Corrected Monthly Close" : "Review Monthly Close";
    byId("closeReviewSummary").innerHTML = [
      ["Month", monthFormatter.format(monthDate(key))],
      ["Snapshot Type", manualHistorical ? "MANUAL HISTORICAL SNAPSHOT" : existing?.status === "reopened" ? "CORRECTED REVISION" : "MONTHLY CLOSE"],
      ["Actual Base Net Income", money(draft.baseNetIncome)],
      ["Actual OT Income", money(draft.actualOtIncome)],
      ["Monthly Income", money(draft.monthlyIncome)],
      ["Monthly Expense", money(draft.monthlyExpense)],
      ["Actual Saving", money(draft.actualSaving)],
      ["Actual Investment", money(draft.actualInvestment)],
      ["Plan Free Cash", money(draft.planFreeCash)],
      ["Goal Funding Applied", money(draft.goalFundingApplied)],
      ["Available Free Cash", money(draft.availableFreeCash)],
      ["Salary Day", String(draft.salaryDay)],
      ["Calendar Projected Cash Balance", money(draft.calendarProjectedBalance)],
      ["Actual Closing Cash Balance", draft.closingBalance === null ? "Not provided" : money(draft.closingBalance)]
    ].map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join("");
    byId("closeReviewConfirmed").checked = false;
    showDialog(byId("closeReviewDialog"), byId("closeReviewConfirmed"));
  }

  function commitCloseMonth() {
    if (!ui.pendingCloseDraft) throw new Error("The close review expired. Review the month again.");
    if (!byId("closeReviewConfirmed").checked) throw new Error("Confirm that you reviewed the values before freezing the month.");
    const draft = ui.pendingCloseDraft;
    const existing = state.closedMonths[draft.key];
    if (isClosedSnapshot(existing)) throw new Error("This month is already closed.");
    const revision = existing ? existing.revision + 1 : 1;
    const closedAt = new Date().toISOString();
    const snapshot = {
      key: draft.key,
      baseNetIncome: draft.baseNetIncome,
      actualOtIncome: draft.actualOtIncome,
      monthlyIncome: draft.monthlyIncome,
      monthlyExpense: draft.monthlyExpense,
      actualSaving: draft.actualSaving,
      actualInvestment: draft.actualInvestment,
      planFreeCash: draft.planFreeCash,
      goalFundingApplied: draft.goalFundingApplied,
      availableFreeCash: draft.availableFreeCash,
      freeCash: draft.availableFreeCash,
      closingBalance: draft.closingBalance,
      calendarProjectedBalance: draft.calendarProjectedBalance,
      salaryDay: draft.salaryDay,
      closedAt,
      status: "closed",
      revision,
      reopenedAt: null,
      reopenReason: null,
      snapshotType: draft.manualHistorical ? "historical-manual" : existing?.snapshotType || "standard",
      auditTrail: existing?.auditTrail ? clone(existing.auditTrail) : [],
      schemaVersion: SCHEMA_VERSION
    };
    snapshot.auditTrail.push({
      id: uid("audit"),
      event: draft.manualHistorical ? "historical-backfill" : "closed",
      at: closedAt,
      revision,
      reason: draft.manualHistorical ? "Confirmed manual historical backfill" : existing ? `Corrected after: ${existing.reopenReason}` : "Confirmed monthly close",
      snapshot: snapshotAuditData(snapshot)
    });
    state.closedMonths[draft.key] = snapshot;
    const saved = persist();
    byId("closeReviewDialog").close();
    ui.pendingCloseDraft = null;
    if (draft.manualHistorical) ui.historicalBackfillKey = null;
    renderActiveView();
    showToast(saved ? `${monthFormatter.format(monthDate(draft.key))} frozen as revision ${revision}; saved locally` : `${monthFormatter.format(monthDate(draft.key))} frozen in memory only`, !saved);
  }

  function openReopenReview() {
    const key = monthKeyAtOffset(ui.closeOffset);
    const snapshot = state.closedMonths[key];
    if (!isClosedSnapshot(snapshot)) throw new Error("Only a closed snapshot can be reopened.");
    ui.pendingReopenKey = key;
    byId("reopenDialogTitle").textContent = `Reopen ${monthFormatter.format(monthDate(key))}`;
    byId("reopenReason").value = "";
    showDialog(byId("reopenDialog"), byId("reopenReason"));
  }

  function reopenSnapshot() {
    const key = ui.pendingReopenKey;
    const snapshot = key ? state.closedMonths[key] : null;
    if (!isClosedSnapshot(snapshot)) throw new Error("The closed snapshot is no longer available.");
    const reason = cleanText(byId("reopenReason").value, "", 180);
    if (!reason) throw new Error("Enter a reason for the correction.");
    const reopenedAt = new Date().toISOString();
    snapshot.auditTrail.push({
      id: uid("audit"),
      event: "reopened",
      at: reopenedAt,
      revision: snapshot.revision,
      reason,
      snapshot: snapshotAuditData(snapshot)
    });
    snapshot.status = "reopened";
    snapshot.reopenedAt = reopenedAt;
    snapshot.reopenReason = reason;
    const saved = persist();
    byId("reopenDialog").close();
    ui.pendingReopenKey = null;
    renderActiveView();
    showPersistenceToast(`${monthFormatter.format(monthDate(key))} reopened; frozen revision ${snapshot.revision} remains in the audit trail`, saved);
  }

  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function exportJSON() {
    state.meta.lastFullBackupAt = new Date().toISOString();
    const saved = persist();
    download(`clean-planner-v11.2-${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json;charset=utf-8");
    if (ui.activeView === "settings") renderSettings();
    showToast(saved ? "JSON backup exported; backup time saved locally" : "JSON backup exported from memory; local backup time could not be saved", !saved);
  }

  function exportCSV() {
    const rows = [["id", "date", "name", "amount", "category_id", "category_label", "recurring", "recurring_id", "created_at"]];
    for (const transaction of [...state.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([transaction.id, transaction.date, transaction.name, transaction.amount.toFixed(2), transaction.categoryId, transaction.categoryLabel || transactionCategoryName(transaction), transaction.recurringTag ? "yes" : "no", transaction.recurringId || "", transaction.createdAt]);
    }
    const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
    download(`clean-planner-v11.2-transactions-${todayISO()}.csv`, csv, "text/csv;charset=utf-8");
    showToast("Transaction CSV exported");
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const next = text[index + 1];
      if (character === '"') {
        if (quoted && next === '"') {
          cell += '"';
          index += 1;
        } else quoted = !quoted;
      } else if (character === "," && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((character === "\n" || character === "\r") && !quoted) {
        if (character === "\r" && next === "\n") index += 1;
        row.push(cell);
        if (row.some(value => value !== "")) rows.push(row);
        row = [];
        cell = "";
      } else cell += character;
    }
    if (quoted) throw new Error("The CSV contains an unclosed quoted value.");
    row.push(cell);
    if (row.some(value => value !== "")) rows.push(row);
    return rows;
  }

  function importReviewRows(items) {
    return items.map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(String(value))}</dd></div>`).join("");
  }

  function openImportReview(pending) {
    ui.pendingImport = pending;
    byId("importReviewTitle").textContent = pending.kind === "json" ? "Review Full Backup Import" : "Review Transaction CSV Import";
    byId("importReviewCopy").textContent = pending.kind === "json"
      ? "The current planner will be backed up before this validated backup replaces it. Any commit failure restores the current state."
      : "Only validated new transactions will be added. Duplicate and invalid rows will not change the planner.";
    byId("importReviewSummary").innerHTML = importReviewRows(pending.summary);
    byId("importReviewConfirmed").checked = false;
    byId("importReviewConfirmLabel").textContent = pending.kind === "json" ? "I reviewed these counts and want to replace the current planner." : "I reviewed these counts and want to add the new rows.";
    byId("importReviewSubmit").disabled = false;
    showDialog(byId("importReviewDialog"), byId("importReviewConfirmed"));
  }

  function createPreImportBackup() {
    const serialized = JSON.stringify(state);
    runtime.inMemoryImportBackup = clone(state);
    const store = storage();
    if (!store) return false;
    try {
      store.setItem(PRE_IMPORT_KEY, serialized);
      return true;
    } catch (error) {
      runtime.storageAvailable = false;
      runtime.storageMessage = `Pre-import backup remains in memory: ${cleanText(error?.message, "storage write failed", 120)}`;
      renderRuntimeStatus();
      return false;
    }
  }

  async function importJSONFile(file) {
    if (!file) return;
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid JSON: ${cleanText(error?.message, "parse error", 130)}`);
    }
    validateImportSource(parsed);
    const migrated = migrateState(parsed, { importing: true });
    validateState(migrated);
    openImportReview({
      kind: "json",
      candidate: migrated,
      summary: [
        ["Categories", migrated.categories.length],
        ["Transactions", migrated.transactions.length],
        ["Recurring", migrated.recurring.length],
        ["Goals", migrated.goals.length],
        ["Closed Months", Object.keys(migrated.closedMonths).length],
        ["OT Months", Object.keys(migrated.otByMonth).length]
      ]
    });
  }

  function fingerprintText(value) {
    return cleanText(value, "", 120).replace(/^'/, "").toLowerCase().replace(/\s+/g, " ");
  }

  function transactionFingerprint(transaction) {
    const category = transaction.categoryId && transaction.categoryId !== "other" ? transaction.categoryId : transaction.categoryLabel || "other";
    return [transaction.date, fingerprintText(transaction.name), roundMoney(transaction.amount).toFixed(2), fingerprintText(category), transaction.recurringTag ? "1" : "0"].join("|");
  }

  async function importCSVFile(file) {
    if (!file) return;
    const rows = parseCSV(await file.text());
    if (rows.length < 2) throw new Error("The CSV has no transaction rows.");
    const headers = rows[0].map(header => header.trim().toLowerCase());
    const required = ["date", "name", "amount"];
    if (!required.every(header => headers.includes(header))) throw new Error("CSV requires date, name, and amount columns.");
    const index = name => headers.indexOf(name);
    const existingIds = new Set(state.transactions.map(transaction => transaction.id));
    const seenIds = new Set(existingIds);
    const seenFingerprints = new Set(state.transactions.map(transactionFingerprint));
    const seenRecurringMonths = new Set(state.transactions.filter(transaction => transaction.recurringId).map(transaction => `${transaction.recurringId}|${transaction.date.slice(0, 7)}`));
    const candidates = [];
    let duplicates = 0;
    let invalid = 0;
    for (const row of rows.slice(1)) {
      const date = row[index("date")]?.trim();
      const name = cleanText(row[index("name")], "", 80).replace(/^'/, "");
      const transactionAmount = roundMoney(row[index("amount")]);
      if (!isISODate(date) || !name || transactionAmount <= 0) {
        invalid += 1;
        continue;
      }
      const rawCategoryId = index("category_id") >= 0 ? cleanText(row[index("category_id")], "other", 70) : "";
      const rawCategoryLabel = index("category_label") >= 0 ? cleanText(row[index("category_label")], "Other", 80).replace(/^'/, "") : "Other";
      const byName = state.categories.find(category => category.name.toLowerCase() === rawCategoryLabel.toLowerCase());
      const categoryId = state.categories.some(category => category.id === rawCategoryId) ? rawCategoryId : byName?.id || "other";
      const recurring = index("recurring") >= 0 && /^(yes|true|1)$/i.test(row[index("recurring")]?.trim());
      const requestedId = index("id") >= 0 ? cleanText(row[index("id")], "", 100).replace(/^'/, "") : "";
      const recurringId = index("recurring_id") >= 0 ? cleanText(row[index("recurring_id")], "", 100).replace(/^'/, "") || null : null;
      const createdAtRaw = index("created_at") >= 0 ? cleanText(row[index("created_at")], "", 40).replace(/^'/, "") : "";
      const transaction = {
        id: requestedId || uid("transaction"),
        name,
        amount: transactionAmount,
        categoryId,
        categoryLabel: rawCategoryLabel,
        date,
        recurringId,
        recurringTag: Boolean(recurring || recurringId),
        createdAt: validTimestamp(createdAtRaw) ? new Date(createdAtRaw).toISOString() : new Date().toISOString()
      };
      const fingerprint = transactionFingerprint(transaction);
      const recurringMonth = recurringId ? `${recurringId}|${date.slice(0, 7)}` : "";
      if ((requestedId && seenIds.has(requestedId)) || seenFingerprints.has(fingerprint) || (recurringMonth && seenRecurringMonths.has(recurringMonth))) {
        duplicates += 1;
        continue;
      }
      seenIds.add(transaction.id);
      seenFingerprints.add(fingerprint);
      if (recurringMonth) seenRecurringMonths.add(recurringMonth);
      candidates.push(transaction);
    }
    openImportReview({
      kind: "csv",
      transactions: candidates,
      duplicates,
      invalid,
      summary: [["New rows", candidates.length], ["Duplicates skipped", duplicates], ["Invalid rows", invalid]]
    });
  }

  function commitImportReview() {
    if (runtime.destructiveBusy) return;
    const pending = ui.pendingImport;
    if (!pending) throw new Error("The import review expired. Choose the file again.");
    if (!byId("importReviewConfirmed").checked) throw new Error("Confirm that you reviewed the import summary before applying it.");
    runtime.destructiveBusy = true;
    byId("importReviewSubmit").disabled = true;
    const previous = clone(state);
    try {
      createPreImportBackup();
      const next = pending.kind === "json" ? clone(pending.candidate) : clone(state);
      if (pending.kind === "csv") next.transactions.push(...clone(pending.transactions));
      validateState(next);
      state = next;
      if (!persist()) throw new Error("The import could not be saved locally, so the previous planner was restored.");
      const message = pending.kind === "json"
        ? "Full backup imported; pre-import backup saved locally"
        : `Imported ${pending.transactions.length} new row${pending.transactions.length === 1 ? "" : "s"}; skipped ${pending.duplicates} duplicate${pending.duplicates === 1 ? "" : "s"} and ${pending.invalid} invalid`;
      ui.pendingImport = null;
      byId("importReviewDialog").close();
      renderActiveView();
      showToast(message);
    } catch (error) {
      state = previous;
      try { persist(); } catch (rollbackError) { runtime.storageMessage = `Rollback remains in memory: ${cleanText(rollbackError?.message, "storage unavailable", 120)}`; }
      renderActiveView();
      throw error;
    } finally {
      runtime.destructiveBusy = false;
      if (byId("importReviewDialog").open) byId("importReviewSubmit").disabled = false;
    }
  }

  async function installApp() {
    if (runtime.deferredInstallPrompt) {
      runtime.deferredInstallPrompt.prompt();
      await runtime.deferredInstallPrompt.userChoice;
      runtime.deferredInstallPrompt = null;
      renderRuntimeStatus();
      return;
    }
    if (matchMedia("(display-mode: standalone)").matches || navigator.standalone === true) {
      showToast("CLEAN // PLANNER is already installed");
      return;
    }
    showToast("Use your browser menu and choose Install app or Add to Home Screen");
  }

  function handleAction(action, control) {
    const id = control.dataset.id || "";
    switch (action) {
      case "save-ot": saveOT(); break;
      case "analyze-purchase": analyzePurchase(); break;
      case "open-transaction": openDialog("transactionDialog", "create"); break;
      case "edit-transaction": openDialog("transactionDialog", "edit", id); break;
      case "delete-transaction": requestConfirmation("delete-transaction", id); break;
      case "open-recurring": openDialog("recurringDialog", "create"); break;
      case "edit-recurring": openDialog("recurringDialog", "edit", id); break;
      case "delete-recurring": requestConfirmation("delete-recurring", id); break;
      case "pay-recurring": requestConfirmation("pay-recurring", id); break;
      case "open-goal": openDialog("goalDialog", "create"); break;
      case "edit-goal": openDialog("goalDialog", "edit", id); break;
      case "delete-goal": requestConfirmation("delete-goal", id); break;
      case "balance-goals": balanceGoalAllocations(); break;
      case "apply-goal-funding": applyGoalFunding(); break;
      case "undo-goal-funding": requestConfirmation("undo-goal-funding"); break;
      case "recalculate-goal-funding": requestConfirmation("recalculate-goal-funding"); break;
      case "open-category": openDialog("categoryDialog", "create"); break;
      case "edit-category": openDialog("categoryDialog", "edit", id); break;
      case "delete-category": requestConfirmation("delete-category", id); break;
      case "save-category-plan": saveCategoryPlan(id); break;
      case "calendar-prev": ui.calendarOffset -= 1; renderActiveView(); break;
      case "calendar-next": ui.calendarOffset += 1; renderActiveView(); break;
      case "save-opening-balance": saveOpeningBalance(); break;
      case "close-prev": ui.historicalBackfillKey = null; ui.closeOffset -= 1; renderActiveView(); break;
      case "close-next": ui.historicalBackfillKey = null; ui.closeOffset = Math.min(0, ui.closeOffset + 1); renderActiveView(); break;
      case "review-close-month": openCloseReview(); break;
      case "open-reopen-review": openReopenReview(); break;
      case "start-historical-backfill": startHistoricalBackfill(); break;
      case "copy-current-plan": copyCurrentPlanToHistoricalDraft(); break;
      case "save-settings": saveSettings(); break;
      case "export-json": exportJSON(); break;
      case "import-json": byId("jsonFileInput").click(); break;
      case "export-csv": exportCSV(); break;
      case "import-csv": byId("csvFileInput").click(); break;
      case "install-app": void installApp(); break;
      case "update-app": updateApp(); break;
      case "close-dialog": closeDialogFrom(control); break;
      default: throw new Error(`Unknown action: ${action}`);
    }
  }

  function attachEvents() {
    byId("closeReviewDialog").addEventListener("cancel", () => { ui.pendingCloseDraft = null; });
    byId("reopenDialog").addEventListener("cancel", () => { ui.pendingReopenKey = null; });
    byId("confirmationDialog").addEventListener("cancel", () => { ui.pendingConfirmation = null; });
    byId("importReviewDialog").addEventListener("cancel", () => { ui.pendingImport = null; });
    document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("close", () => {
      const target = ui.returnFocus;
      ui.returnFocus = null;
      requestAnimationFrame(() => (target?.isConnected ? target : byId("mainContent"))?.focus());
    }));
    document.addEventListener("click", event => {
      const viewControl = event.target.closest("[data-view]");
      if (viewControl) {
        event.preventDefault();
        safely(() => navigate(viewControl.dataset.view));
        return;
      }
      const actionControl = event.target.closest("[data-action]");
      if (actionControl) {
        event.preventDefault();
        safely(() => handleAction(actionControl.dataset.action, actionControl));
      }
    });

    document.addEventListener("submit", event => {
      event.preventDefault();
      clearApplicationError();
      clearFormError(event.target);
      try {
        if (event.target.id === "transactionForm") saveTransaction();
        else if (event.target.id === "recurringForm") saveRecurring();
        else if (event.target.id === "goalForm") saveGoal();
        else if (event.target.id === "categoryForm") saveCategory();
        else if (event.target.id === "closeReviewForm") commitCloseMonth();
        else if (event.target.id === "reopenForm") reopenSnapshot();
        else if (event.target.id === "confirmationForm") commitConfirmation();
        else if (event.target.id === "importReviewForm") commitImportReview();
        else throw new Error("Unknown form submission.");
      } catch (error) {
        showApplicationError(error);
        showFormError(event.target, error);
      }
    });

    document.addEventListener("input", event => {
      if (event.target.id === "transactionSearch") {
        ui.transactionSearch = event.target.value;
        safely(renderTransactions);
      } else if (["closeBaseIncomeInput", "closeOtIncomeInput", "closeExpenseInput", "closeGoalFundingInput", "closeActualSaving", "closeActualInvestment", "closeSalaryDayInput", "closeBalanceInput"].includes(event.target.id)) {
        safely(previewCloseInputs);
      }
    });

    document.addEventListener("change", event => {
      safely(() => {
        if (event.target.id === "transactionMonth") {
          ui.transactionMonth = isMonthKey(event.target.value) ? event.target.value : currentMonthKey();
          renderTransactions();
        } else if (event.target.id === "transactionCategoryFilter") {
          ui.transactionCategory = event.target.value;
          renderTransactions();
        } else if (event.target.id === "transactionTypeFilter") {
          ui.transactionType = event.target.value;
          renderTransactions();
        } else if (event.target.id === "calendarOpeningBalance") {
          saveOpeningBalance();
        } else if (event.target.id === "jsonFileInput") {
          void importJSONFile(event.target.files?.[0]).catch(showApplicationError).finally(() => { event.target.value = ""; });
        } else if (event.target.id === "csvFileInput") {
          void importCSVFile(event.target.files?.[0]).catch(showApplicationError).finally(() => { event.target.value = ""; });
        }
      });
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Enter" && event.target.classList.contains("monthly-expense-input")) {
        event.preventDefault();
        safely(() => saveCategoryPlan(event.target.dataset.categoryId));
      }
    });

    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      runtime.deferredInstallPrompt = event;
      renderRuntimeStatus();
    });
    window.addEventListener("online", renderRuntimeStatus);
    window.addEventListener("offline", renderRuntimeStatus);
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") {
      runtime.serviceWorkerMessage = location.protocol === "file:" ? "PWA requires HTTP or HTTPS" : "Service worker unsupported";
      renderRuntimeStatus();
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      runtime.serviceWorkerReady = true;
      runtime.serviceWorkerMessage = navigator.serviceWorker.controller ? "Offline ready" : "Offline cache installed; reload once";
      const exposeWaitingUpdate = () => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          runtime.updateRegistration = registration;
          renderRuntimeStatus();
        }
      };
      exposeWaitingUpdate();
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") exposeWaitingUpdate();
        });
      });
      try {
        await registration.update();
      } catch (error) {
        if (!registration.active && !navigator.serviceWorker.controller) throw error;
      }
    } catch (error) {
      runtime.serviceWorkerReady = false;
      runtime.serviceWorkerMessage = `Offline unavailable: ${cleanText(error?.message, "registration failed", 100)}`;
    }
    renderRuntimeStatus();
  }

  function updateApp() {
    const waiting = runtime.updateRegistration?.waiting;
    if (!waiting) throw new Error("No waiting app update is available.");
    runtime.updateRequested = true;
    byId("updateBanner").querySelector("button").disabled = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  }

  function initialize() {
    attachEvents();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!runtime.updateRequested || runtime.updateReloaded) return;
        runtime.updateReloaded = true;
        location.reload();
      });
    }
    const requestedView = location.hash.slice(1);
    if (VIEW_IDS.has(requestedView)) ui.activeView = requestedView;
    if (runtime.migrationMessage || !state.meta.updatedAt) persist();
    renderApp();
    if (runtime.startupError) showApplicationError(new Error(runtime.startupError));
    void registerServiceWorker();
    globalThis.CleanPlanner = Object.freeze({
      version: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      calculateFinance: () => clone(calculateFinance()),
      getState: () => clone(state),
      navigate: view => navigate(view, false)
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => safely(initialize), { once: true });
  else safely(initialize);
})();

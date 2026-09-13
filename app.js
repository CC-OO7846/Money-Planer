"use strict";

(() => {
  const APP_VERSION = "11.1.0";
  const SCHEMA_VERSION = 11;
  const STORAGE_KEY = "clean_planner_dime_style_v1";
  const CORRUPT_PREFIX = `${STORAGE_KEY}_corrupt_`;
  const MAX_AMOUNT = 1_000_000_000_000;
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
    pendingReopenKey: null
  };

  const runtime = {
    storageAvailable: true,
    storageMessage: "Local storage ready",
    migrationMessage: "",
    serviceWorkerReady: false,
    serviceWorkerMessage: "Checking service worker…",
    deferredInstallPrompt: null,
    toastTimer: 0
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
        monthlyAmount: amount(category?.monthlyAmount ?? category?.budget)
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
      const transactionAmount = amount(item?.amount);
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
        createdAt: cleanText(item?.createdAt, new Date().toISOString(), 40)
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
      const recurringAmount = amount(item?.amount);
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
        createdAt: cleanText(item?.createdAt, new Date().toISOString(), 40)
      });
    }
    return recurringItems;
  }

  function normalizeGoals(source) {
    if (!Array.isArray(source)) return [];
    const used = new Set();
    const goals = [];

    for (const item of source) {
      const target = amount(item?.target);
      if (target <= 0) continue;
      const requestedId = cleanText(item?.id, uid("goal"), 100);
      const id = used.has(requestedId) ? uid("goal") : requestedId;
      used.add(id);
      goals.push({
        id,
        name: cleanText(item?.name, "Goal", 80),
        currentAmount: clamp(amount(item?.currentAmount ?? item?.current), 0, target),
        target,
        allocationPercent: clamp(amount(item?.allocationPercent ?? item?.allocPct), 0, 100),
        createdAt: cleanText(item?.createdAt, new Date().toISOString(), 40)
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
        target: amount(record.target ?? record.otTarget),
        actualEarned: amount(record.actualEarned ?? record.actualOtEarned ?? record.actualOT),
        updatedAt: cleanText(record.updatedAt, new Date().toISOString(), 40)
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
      const baseNetIncome = amount(item.baseNetIncome ?? item.actualBaseNetIncome ?? item.income);
      const actualOtIncome = amount(item.actualOtIncome ?? item.actualOT ?? item.ot);
      const monthlyExpense = amount(item.monthlyExpense ?? item.expense);
      const actualSaving = amount(item.actualSaving ?? item.saving);
      const actualInvestment = amount(item.actualInvestment ?? item.investment);
      const planFreeCash = baseNetIncome + actualOtIncome - monthlyExpense - actualSaving - actualInvestment;
      const goalFundingApplied = amount(item.goalFundingApplied, normalizedActiveFundingAmount(allocationHistory, key));
      const availableFreeCash = planFreeCash - goalFundingApplied;
      const closingRaw = item.closingBalance ?? item.endingBalance;
      const projectedRaw = item.calendarProjectedBalance ?? item.projectedClosingBalance ?? closingRaw;
      const status = item.status === "reopened" ? "reopened" : "closed";
      const revision = wholeNumber(item.revision, 1, 1, 10_000);
      const auditTrail = Array.isArray(item.auditTrail) ? item.auditTrail.map(entry => ({
        id: cleanText(entry?.id, uid("audit"), 100),
        event: entry?.event === "reopened" ? "reopened" : "closed",
        at: cleanText(entry?.at, new Date().toISOString(), 40),
        revision: wholeNumber(entry?.revision, revision, 1, 10_000),
        reason: cleanText(entry?.reason, "", 180),
        snapshot: entry?.snapshot && typeof entry.snapshot === "object" ? {
          baseNetIncome: amount(entry.snapshot.baseNetIncome),
          actualOtIncome: amount(entry.snapshot.actualOtIncome),
          monthlyExpense: amount(entry.snapshot.monthlyExpense),
          actualSaving: amount(entry.snapshot.actualSaving),
          actualInvestment: amount(entry.snapshot.actualInvestment),
          planFreeCash: amount(entry.snapshot.planFreeCash, 0, true),
          goalFundingApplied: amount(entry.snapshot.goalFundingApplied),
          availableFreeCash: amount(entry.snapshot.availableFreeCash ?? entry.snapshot.freeCash, 0, true),
          closingBalance: entry.snapshot.closingBalance == null || entry.snapshot.closingBalance === "" ? null : amount(entry.snapshot.closingBalance, 0, true),
          calendarProjectedBalance: entry.snapshot.calendarProjectedBalance == null || entry.snapshot.calendarProjectedBalance === "" ? null : amount(entry.snapshot.calendarProjectedBalance, 0, true),
          salaryDay: wholeNumber(entry.snapshot.salaryDay, fallbackSalaryDay, 1, 28)
        } : null
      })) : [];
      normalized[key] = {
        key,
        baseNetIncome,
        actualOtIncome,
        monthlyIncome: baseNetIncome + actualOtIncome,
        monthlyExpense,
        actualSaving,
        actualInvestment,
        planFreeCash,
        goalFundingApplied,
        availableFreeCash,
        freeCash: availableFreeCash,
        closingBalance: closingRaw == null || closingRaw === "" ? null : amount(closingRaw, 0, true),
        calendarProjectedBalance: projectedRaw == null || projectedRaw === "" ? null : amount(projectedRaw, 0, true),
        salaryDay: wholeNumber(item.salaryDay, fallbackSalaryDay, 1, 28),
        closedAt: cleanText(item.closedAt, new Date().toISOString(), 40),
        status,
        revision,
        reopenedAt: status === "reopened" ? cleanText(item.reopenedAt, new Date().toISOString(), 40) : null,
        reopenReason: status === "reopened" ? cleanText(item.reopenReason, "Correction requested", 180) : null,
        auditTrail,
        schemaVersion: SCHEMA_VERSION
      };
      if (!normalized[key].auditTrail.length) {
        normalized[key].auditTrail.push({ id: uid("audit"), event: "closed", at: normalized[key].closedAt, revision, reason: "Migrated closed snapshot" });
      }
    }
    return normalized;
  }

  function normalizeNumericMap(raw, allowNegative = false) {
    const normalized = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return normalized;
    for (const [key, value] of Object.entries(raw)) {
      if (isMonthKey(key)) normalized[key] = amount(value, 0, allowNegative);
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
                amount: amount(entry?.amount),
                beforeAmount: Number.isFinite(Number(beforeRaw)) ? amount(beforeRaw) : null,
                afterAmount: Number.isFinite(Number(afterRaw)) ? amount(afterRaw) : null
              };
            }).filter(entry => entry.goalId && entry.amount > 0)
          : [];
        const undoneAt = cleanText(cycle?.undoneAt, "", 40) || null;
        return {
          id: cleanText(cycle?.id, `funding-${key}-${index + 1}`, 100),
          availablePool: amount(cycle?.availablePool ?? cycle?.pool),
          appliedAmount: amount(cycle?.appliedAmount ?? cycle?.pool),
          allocations,
          appliedAt: cleanText(cycle?.appliedAt ?? cycle?.at, new Date().toISOString(), 40),
          status: undoneAt || cycle?.status === "undone" ? "undone" : "applied",
          undoneAt,
          undoReason: cleanText(cycle?.undoReason, "", 180) || null,
          legacyBalanceMutation: !Array.isArray(item.cycles) || cycle?.legacyBalanceMutation === true
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
    const legacyStructure = !raw.settings || sourceVersion < 10;
    const needsUpgrade = sourceVersion < SCHEMA_VERSION;
    const rawSettings = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
    const categories = normalizeCategories(raw.categories);
    const allocationHistory = normalizeAllocationHistory(raw.allocationHistory);
    const state = {
      schemaVersion: SCHEMA_VERSION,
      settings: {
        baseNetIncome: amount(rawSettings.baseNetIncome ?? raw.income, base.settings.baseNetIncome),
        emergencyFund: amount(rawSettings.emergencyFund ?? raw.emergencyFund, base.settings.emergencyFund),
        savingGoal: amount(rawSettings.savingGoal ?? raw.savingGoal, base.settings.savingGoal),
        investmentGoal: amount(rawSettings.investmentGoal ?? raw.investmentGoal, base.settings.investmentGoal),
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
        threshold: amount(raw.allocationRules?.threshold, base.allocationRules.threshold)
      },
      allocationHistory,
      meta: {
        createdAt: cleanText(raw.meta?.createdAt, base.meta.createdAt, 40),
        updatedAt: new Date().toISOString(),
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
      } catch (backupError) {
        runtime.storageMessage = `Recovered in memory; corrupt data could not be backed up: ${cleanText(backupError?.message, "storage error", 120)}`;
      }
      runtime.migrationMessage = cleanText(error?.message, "Stored data was corrupt", 180);
      return freshState();
    }
  }

  let state = loadState();

  function persist() {
    state.schemaVersion = SCHEMA_VERSION;
    state.meta.updatedAt = new Date().toISOString();
    const store = storage();
    if (!store) return false;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(state));
      runtime.storageAvailable = true;
      runtime.storageMessage = runtime.migrationMessage || "Local storage ready";
      return true;
    } catch (error) {
      runtime.storageAvailable = false;
      runtime.storageMessage = `Changes remain in memory: ${cleanText(error?.message, "storage write failed", 140)}`;
      showToast(runtime.storageMessage, true);
      return false;
    }
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
    return state.categories.reduce((sum, category) => sum + amount(category.monthlyAmount), 0);
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
    return amount(activeGoalFundingCycle(key)?.appliedAmount);
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
    const baseNetIncome = amount(overrides.baseNetIncome ?? state.settings.baseNetIncome);
    const actualOtIncome = amount(ot);
    const monthlyIncome = baseNetIncome + actualOtIncome;
    const monthlyExpense = amount(overrides.monthlyExpense ?? plannedMonthlyExpense());
    const savingGoal = amount(overrides.savingGoal ?? state.settings.savingGoal);
    const investmentGoal = amount(overrides.investmentGoal ?? state.settings.investmentGoal);
    const savingInvestment = savingGoal + investmentGoal;
    const planFreeCash = monthlyIncome - monthlyExpense - savingGoal - investmentGoal;
    const goalFundingApplied = amount(overrides.goalFundingApplied ?? goalFundingAppliedForMonth(key));
    const availableFreeCash = planFreeCash - goalFundingApplied;
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
    const rules = state.allocationRules;
    const availableCash = Math.max(0, finance.availableFreeCash);
    const otComponent = rules.otEnabled ? finance.actualOtIncome * (rules.otPercent / 100) : 0;
    const surplusBase = Math.max(0, finance.availableFreeCash - rules.threshold);
    const surplusComponent = surplusBase * (rules.surplusPercent / 100);
    return Math.min(availableCash, Math.max(0, otComponent + surplusComponent));
  }

  function summaryForMonth(key) {
    const closed = state.closedMonths[key];
    if (isClosedSnapshot(closed)) {
      const monthlyIncome = closed.baseNetIncome + closed.actualOtIncome;
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
        source: "CLOSED"
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
    banner.textContent = `CLEAN // PLANNER could not complete that action: ${cleanText(error?.message, "Unknown error", 220)}`;
    banner.hidden = false;
  }

  function clearApplicationError() {
    const banner = document.getElementById("errorBanner");
    if (banner) banner.hidden = true;
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
    const daily = finance.availableFreeCash / daysUntilPayday();
    insights.push({ icon: "÷", tone: "mint", title: `${money(daily)}/day until payday`, copy: `Based on ${daysUntilPayday()} day${daysUntilPayday() === 1 ? "" : "s"} and Available Free Cash after applied Goal Funding.` });

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

    const query = ui.transactionSearch.toLowerCase();
    const items = state.transactions
      .filter(transaction => transaction.date.startsWith(ui.transactionMonth))
      .filter(transaction => !query || transaction.name.toLowerCase().includes(query) || transactionCategoryName(transaction).toLowerCase().includes(query))
      .filter(transaction => !ui.transactionCategory || transaction.categoryId === ui.transactionCategory)
      .filter(transaction => !ui.transactionType || (ui.transactionType === "recurring" ? transaction.recurringTag : !transaction.recurringTag))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

    const total = items.reduce((sum, transaction) => sum + transaction.amount, 0);
    byId("transactionSummary").textContent = `${items.length} transaction${items.length === 1 ? "" : "s"} · ${money(total)}`;
    byId("transactionList").innerHTML = items.length ? items.map(transaction => `<article class="record-card"><div class="record-main"><span class="category-icon" aria-hidden="true">${escapeHTML(categoryById(transaction.categoryId)?.icon || "□")}</span><div class="record-copy"><h2 class="record-title">${escapeHTML(transaction.name)}</h2><div class="record-meta"><span>${escapeHTML(dateFormatter.format(new Date(`${transaction.date}T12:00:00`)))}</span><span>${escapeHTML(transactionCategoryName(transaction))}</span>${transaction.recurringTag ? "<span>Recurring</span>" : ""}</div></div></div><div class="record-side"><strong class="record-amount">${money(transaction.amount)}</strong><div class="record-actions"><button type="button" class="button button--secondary" data-action="edit-transaction" data-id="${escapeHTML(transaction.id)}">Edit</button><button type="button" class="button button--danger" data-action="delete-transaction" data-id="${escapeHTML(transaction.id)}">Delete</button></div></div></article>`).join("") : emptyState("≡", "No matching transactions", "Add a transaction or adjust the month and filters.");
  }

  function recurringStatus(item, key = currentMonthKey()) {
    if (!item.active) return { label: "PAUSED", tone: "" };
    const paid = state.transactions.some(transaction => transaction.recurringId === item.id && transaction.date.startsWith(key));
    if (paid) return { label: "PAID", tone: "status-chip--good" };
    if (key < currentMonthKey()) return { label: "DUE", tone: "status-chip--danger" };
    if (key > currentMonthKey()) return { label: "UPCOMING", tone: "" };
    const today = Number(todayISO().slice(-2));
    return item.day <= today ? { label: "DUE", tone: "status-chip--amber" } : { label: "UPCOMING", tone: "" };
  }

  function renderRecurring() {
    const statuses = state.recurring.map(item => recurringStatus(item));
    byId("recurringUpcomingCount").textContent = String(statuses.filter(status => status.label === "UPCOMING").length);
    byId("recurringDueCount").textContent = String(statuses.filter(status => status.label === "DUE").length);
    byId("recurringPaidCount").textContent = String(statuses.filter(status => status.label === "PAID").length);
    const items = [...state.recurring].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));
    byId("recurringList").innerHTML = items.length ? items.map(item => {
      const status = recurringStatus(item);
      return `<article class="record-card"><div class="record-main"><span class="category-icon" aria-hidden="true">${escapeHTML(categoryById(item.categoryId)?.icon || "□")}</span><div class="record-copy"><h2 class="record-title">${escapeHTML(item.name)}</h2><div class="record-meta"><span>Due day ${item.day}</span><span>${escapeHTML(categoryById(item.categoryId)?.name || "Other")}</span><span class="status-chip ${status.tone}">${status.label}</span></div></div></div><div class="record-side"><strong class="record-amount">${money(item.amount)}</strong><div class="record-actions">${item.active && status.label !== "PAID" ? `<button type="button" class="button button--primary" data-action="pay-recurring" data-id="${escapeHTML(item.id)}">Mark Paid</button>` : ""}<button type="button" class="button button--secondary" data-action="edit-recurring" data-id="${escapeHTML(item.id)}">Edit</button><button type="button" class="button button--danger" data-action="delete-recurring" data-id="${escapeHTML(item.id)}">Delete</button></div></div></article>`;
    }).join("") : emptyState("↻", "No recurring expenses", "Add rent, subscriptions, or other regular bills.");
  }

  function renderGoals() {
    const finance = calculateFinance();
    const pool = goalFundingPool(finance);
    const key = currentMonthKey();
    const activeCycle = activeGoalFundingCycle(key);
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
      return `<article class="record-card"><div class="record-main"><span class="category-icon" aria-hidden="true">${isApplied ? "→" : "↶"}</span><div class="record-copy"><h2 class="record-title">${money(cycle.appliedAmount)} ${isApplied ? "applied" : "undone"}</h2><div class="record-meta"><span>${escapeHTML(dateFormatter.format(new Date(cycle.appliedAt)))}</span><span>${allocations}</span>${cycle.undoReason ? `<span>${escapeHTML(cycle.undoReason)}</span>` : ""}</div></div></div><div class="record-side"><span class="status-chip ${isApplied ? "status-chip--good" : ""}">${isApplied ? "APPLIED" : "UNDONE"}</span></div></article>`;
    }).join("") : emptyState("→", "No funding applied", "Apply funding once allocations and the available pool are ready.");
  }

  function financialInputsForCalendar(key, overrides = {}) {
    if (Object.hasOwn(overrides, "baseIncome") || Object.hasOwn(overrides, "actualOt") || Object.hasOwn(overrides, "salaryDay")) {
      return {
        baseIncome: amount(overrides.baseIncome),
        actualOt: amount(overrides.actualOt),
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
    const openingBalance = amount(state.calendarOpeningBalances[key], 0, true);
    const financial = financialInputsForCalendar(key, overrides);
    const snapshot = state.closedMonths[key];
    const goalFundingApplied = amount(
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

    const recurring = [...state.recurring].filter(item => item.active).sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
    for (const item of recurring) {
      const posted = monthTransactions.some(transaction => transaction.recurringId === item.id);
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
      running += total;
      const iso = `${key}-${String(day).padStart(2, "0")}`;
      const labels = dayEvents.map(event => `${event.label}: ${money(event.amount)}`).join("; ");
      const dots = dayEvents.slice(0, 8).map(event => `<i class="calendar-dot calendar-dot--${escapeHTML(event.type)}"></i>`).join("");
      cells += `<div class="calendar-cell ${iso === todayISO() ? "is-today" : ""}" role="gridcell" aria-label="${escapeHTML(`${iso}. ${labels || "No events"}. Running balance ${money(running)}.`)}"><span class="calendar-day">${day}</span>${dayEvents.length ? `<span class="calendar-total ${total >= 0 ? "is-positive" : "is-negative"}" title="${escapeHTML(money(total))}">${compactMoney(total)}</span><span class="calendar-dots" aria-hidden="true">${dots}</span>` : ""}<span class="calendar-running">Bal ${compactMoney(running).replace(/^\+/, "")}</span></div>`;
    }

    return {
      key,
      cells,
      openingBalance,
      closingBalance: running,
      net: running - openingBalance,
      financial,
      goalFundingApplied,
      monthTransactions,
      scheduledCount: [...events.values()].flat().filter(event => event.type === "scheduled").length
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
    byId("calendarNote").textContent = `${result.monthTransactions.length} posted transaction${result.monthTransactions.length === 1 ? "" : "s"}, ${result.scheduledCount} upcoming recurring item${result.scheduledCount === 1 ? "" : "s"}, ${money(result.goalFundingApplied)} Goal Funding transfer. Income source: ${result.financial.source}.`;
  }

  function saveOpeningBalance() {
    const key = monthKeyAtOffset(ui.calendarOffset);
    state.calendarOpeningBalances[key] = amount(byId("calendarOpeningBalance").value, 0, true);
    persist();
    renderCalendar();
    showToast("Opening balance saved");
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
        snapshot
      };
    }
    const isCurrent = key === currentMonthKey();
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
      snapshot: null
    };
  }

  function closeDraftFromInputs() {
    const key = monthKeyAtOffset(ui.closeOffset);
    const original = openCloseDraft(key);
    const reopened = original.snapshot?.status === "reopened";
    if (key !== currentMonthKey() && !reopened) throw new Error("Only the active month or a reopened snapshot can be closed.");
    const baseNetIncome = amount(byId("closeBaseIncomeInput").value);
    const actualOtIncome = amount(byId("closeOtIncomeInput").value);
    const actualSaving = amount(byId("closeActualSaving").value);
    const actualInvestment = amount(byId("closeActualInvestment").value);
    const salaryDay = wholeNumber(byId("closeSalaryDayInput").value, original.salaryDay, 1, 28);
    const monthlyExpense = original.monthlyExpense;
    const activeCycle = activeGoalFundingCycle(key);
    const goalFundingApplied = key === currentMonthKey()
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
      closingBalance: closingRaw === "" ? null : amount(closingRaw, 0, true),
      calendarProjectedBalance: calendar.closingBalance,
      salaryDay,
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
    const canEdit = isCurrent || isReopened;
    byId("closeMonthLabel").textContent = monthFormatter.format(monthDate(key));
    byId("closeBaseIncomeInput").value = String(draft.baseNetIncome);
    byId("closeOtIncomeInput").value = String(draft.actualOtIncome);
    byId("closeExpense").textContent = money(draft.monthlyExpense);
    byId("closePlanFreeCash").textContent = money(draft.planFreeCash);
    byId("closeGoalFundingApplied").textContent = money(draft.goalFundingApplied);
    byId("closeAvailableFreeCash").textContent = money(draft.availableFreeCash);
    byId("closeAvailableFreeCash").className = draft.availableFreeCash < 0 ? "danger-text" : "good-text";
    byId("closeCalendarProjected").textContent = draft.calendarProjectedBalance == null ? "—" : money(draft.calendarProjectedBalance);
    byId("closeActualSaving").value = String(draft.actualSaving);
    byId("closeActualInvestment").value = String(draft.actualInvestment);
    byId("closeSalaryDayInput").value = String(draft.salaryDay);
    byId("closeBalanceInput").value = draft.closingBalance === null ? "" : String(draft.closingBalance);
    ["closeBaseIncomeInput", "closeOtIncomeInput", "closeActualSaving", "closeActualInvestment", "closeSalaryDayInput", "closeBalanceInput"].forEach(id => { byId(id).disabled = !canEdit || isClosed; });
    byId("closeMonthButton").hidden = !canEdit || isClosed;
    byId("closeMonthButton").disabled = !canEdit || isClosed;
    byId("closeMonthButton").textContent = isReopened ? "Review & Reclose Month" : "Review & Close Month";
    byId("reopenMonthButton").hidden = !isClosed;
    const status = byId("closeStatus");
    status.textContent = isClosed ? "CLOSED" : isReopened ? "REOPENED" : isCurrent ? "OPEN" : "UNAVAILABLE";
    status.className = `status-chip ${isClosed ? "status-chip--good" : canEdit ? "status-chip--amber" : ""}`;
    byId("closeNote").textContent = isClosed
      ? `Revision ${draft.snapshot.revision} closed ${dateFormatter.format(new Date(draft.snapshot.closedAt))}. Reopen records the frozen values before correction.`
      : isReopened ? `Correction open: ${draft.snapshot.reopenReason}. Review is required to freeze revision ${draft.snapshot.revision + 1}.`
      : isCurrent ? "Edit actual income if needed, then complete the required review before freezing." : "Historical months without a snapshot are not synthesized from today’s settings.";

    const auditTrail = draft.snapshot?.auditTrail || [];
    byId("closeRevision").textContent = draft.snapshot ? `REVISION ${draft.snapshot.revision}` : "NO REVISION";
    byId("closeAuditList").innerHTML = auditTrail.length ? [...auditTrail].reverse().map(entry => `<article class="record-card"><div class="record-main"><span class="category-icon" aria-hidden="true">${entry.event === "reopened" ? "↶" : "□"}</span><div class="record-copy"><h2 class="record-title">${entry.event === "reopened" ? "Reopened for correction" : "Snapshot frozen"}</h2><div class="record-meta"><span>Revision ${entry.revision}</span><span>${escapeHTML(dateFormatter.format(new Date(entry.at)))}</span>${entry.reason ? `<span>${escapeHTML(entry.reason)}</span>` : ""}</div></div></div><div class="record-side"><span class="status-chip ${entry.event === "closed" ? "status-chip--good" : "status-chip--amber"}">${entry.event.toUpperCase()}</span></div></article>`).join("") : emptyState("□", "No audit entries", "The first confirmed close creates revision 1.");

    const closedItems = Object.values(state.closedMonths).sort((a, b) => b.key.localeCompare(a.key));
    byId("closedMonthList").innerHTML = closedItems.length ? closedItems.map(item => `<article class="record-card"><div class="record-main"><span class="category-icon" aria-hidden="true">□</span><div class="record-copy"><h2 class="record-title">${escapeHTML(monthFormatter.format(monthDate(item.key)))}</h2><div class="record-meta"><span>Income ${money(item.monthlyIncome)}</span><span>Expense ${money(item.monthlyExpense)}</span><span>OT ${money(item.actualOtIncome)}</span><span>Plan Free Cash ${money(item.planFreeCash)}</span><span>Goal Funding ${money(item.goalFundingApplied)}</span></div></div></div><div class="record-side"><strong class="record-amount ${item.availableFreeCash < 0 ? "danger-text" : "good-text"}">${money(item.availableFreeCash)}</strong><span class="status-chip ${item.status === "reopened" ? "status-chip--amber" : "status-chip--good"}">${item.status === "reopened" ? "REOPENED" : `CLOSED R${item.revision}`}</span></div></article>`).join("") : emptyState("□", "No closed months", "Close the active month to begin verified trend history.");
  }

  function previewCloseInputs() {
    const draft = closeDraftFromInputs();
    byId("closePlanFreeCash").textContent = money(draft.planFreeCash);
    byId("closeGoalFundingApplied").textContent = money(draft.goalFundingApplied);
    byId("closeAvailableFreeCash").textContent = money(draft.availableFreeCash);
    byId("closeAvailableFreeCash").className = draft.availableFreeCash < 0 ? "danger-text" : "good-text";
    byId("closeCalendarProjected").textContent = money(draft.calendarProjectedBalance);
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
    byId("categoryManagerList").innerHTML = state.categories.map(category => {
      const linkedTransactions = state.transactions.filter(transaction => transaction.categoryId === category.id).length;
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
    renderRuntimeStatus();
  }

  function renderRuntimeStatus() {
    const dataStatus = document.getElementById("localDataStatus");
    const connectionStatus = document.getElementById("connectionStatus");
    const installButton = document.getElementById("installAppButton");
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
  }

  function openDialog(dialogId, mode, itemId = "") {
    const dialog = byId(dialogId);
    if (!(dialog instanceof HTMLDialogElement)) throw new Error(`${dialogId} is not a valid dialog.`);
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
    dialog.showModal();
    requestAnimationFrame(() => dialog.querySelector("input:not([type='hidden']), select")?.focus());
  }

  function closeDialogFrom(control) {
    const dialog = control.closest("dialog");
    if (dialog?.id === "closeReviewDialog") ui.pendingCloseDraft = null;
    if (dialog?.id === "reopenDialog") ui.pendingReopenKey = null;
    if (dialog?.open) dialog.close();
  }

  function saveTransaction() {
    const id = byId("transactionId").value;
    const existing = state.transactions.find(transaction => transaction.id === id);
    const name = cleanText(byId("transactionName").value, "", 80);
    const transactionAmount = amount(byId("transactionAmount").value);
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
    persist();
    byId("transactionDialog").close();
    renderActiveView();
    showToast(existing ? "Transaction updated" : "Transaction added");
  }

  function saveRecurring() {
    const id = byId("recurringId").value;
    const existing = state.recurring.find(item => item.id === id);
    const name = cleanText(byId("recurringName").value, "", 80);
    const recurringAmount = amount(byId("recurringAmount").value);
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
    persist();
    byId("recurringDialog").close();
    renderActiveView();
    showToast(existing ? "Recurring expense updated" : "Recurring expense added");
  }

  function saveGoal() {
    const id = byId("goalId").value;
    const existing = state.goals.find(goal => goal.id === id);
    const name = cleanText(byId("goalName").value, "", 80);
    const target = amount(byId("goalTarget").value);
    const currentAmount = amount(byId("goalCurrent").value);
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
    persist();
    byId("goalDialog").close();
    renderActiveView();
    showToast(existing ? "Goal updated" : "Goal added");
  }

  function saveCategory() {
    const id = byId("categoryId").value;
    const existing = state.categories.find(category => category.id === id);
    const name = cleanText(byId("categoryName").value, "", 60);
    const icon = cleanText(byId("categoryIcon").value, "•", 4);
    const monthlyAmount = amount(byId("categoryAmount").value);
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
    persist();
    byId("categoryDialog").close();
    renderActiveView();
    showToast(existing ? "Category updated" : "Category added");
  }

  function saveCategoryPlan(id) {
    const category = state.categories.find(item => item.id === id);
    const input = document.querySelector(`.monthly-expense-input[data-category-id="${CSS.escape(id)}"]`);
    if (!category || !input) throw new Error("The selected category is unavailable.");
    category.monthlyAmount = amount(input.value);
    persist();
    renderActiveView();
    showToast(`${category.name} updated to ${money(category.monthlyAmount)}`);
  }

  function saveOT() {
    const target = amount(byId("otTargetInput").value);
    const actualEarned = amount(byId("otActualInput").value);
    state.otByMonth[currentMonthKey()] = { target, actualEarned, updatedAt: new Date().toISOString() };
    persist();
    renderActiveView();
    showToast("OT values updated across the app");
  }

  function saveSettings() {
    const otPercent = amount(byId("settingOtPercent").value);
    const surplusPercent = amount(byId("settingSurplusPercent").value);
    if (otPercent > 100 || surplusPercent > 100) throw new Error("Funding rule percentages must be between 0% and 100%.");
    state.settings = {
      baseNetIncome: amount(byId("settingBaseIncome").value),
      emergencyFund: amount(byId("settingEmergencyFund").value),
      savingGoal: amount(byId("settingSavingGoal").value),
      investmentGoal: amount(byId("settingInvestmentGoal").value),
      salaryDay: wholeNumber(byId("settingSalaryDay").value, state.settings.salaryDay, 1, 28)
    };
    state.allocationRules = {
      otEnabled: byId("settingOtFundingEnabled").checked,
      otPercent,
      surplusPercent,
      threshold: amount(byId("settingFundingThreshold").value)
    };
    persist();
    renderActiveView();
    showToast("Settings saved");
  }

  function deleteTransaction(id) {
    const item = state.transactions.find(transaction => transaction.id === id);
    if (!item) throw new Error("Transaction not found.");
    if (!confirm(`Delete transaction “${item.name}”?`)) return;
    state.transactions = state.transactions.filter(transaction => transaction.id !== id);
    persist();
    renderActiveView();
    showToast("Transaction deleted");
  }

  function deleteRecurring(id) {
    const item = state.recurring.find(recurring => recurring.id === id);
    if (!item) throw new Error("Recurring expense not found.");
    if (!confirm(`Delete recurring expense “${item.name}”? Existing transactions will be preserved.`)) return;
    state.recurring = state.recurring.filter(recurring => recurring.id !== id);
    persist();
    renderActiveView();
    showToast("Recurring expense deleted; transaction history preserved");
  }

  function deleteGoal(id) {
    const item = state.goals.find(goal => goal.id === id);
    if (!item) throw new Error("Goal not found.");
    if (activeFundingForGoal(id) > 0) throw new Error("Undo current-month Goal Funding before deleting this funded goal.");
    if (!confirm(`Delete goal “${item.name}”?`)) return;
    state.goals = state.goals.filter(goal => goal.id !== id);
    persist();
    renderActiveView();
    showToast("Goal deleted");
  }

  function deleteCategory(id) {
    const category = state.categories.find(item => item.id === id);
    if (!category) throw new Error("Category not found.");
    if (id === "other") throw new Error("Other is the required fallback category and cannot be deleted.");
    if (!confirm(`Delete category “${category.name}”? Linked transactions will move to Other and keep the old label.`)) return;
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
    persist();
    renderActiveView();
    showToast("Category deleted; linked history preserved under Other");
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
    persist();
    renderActiveView();
    showToast(`${item.name} marked paid; Monthly Expense plan unchanged`);
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
    persist();
    renderActiveView();
    showToast("Goal allocation balanced to 100%");
  }

  function applyGoalFunding() {
    const key = currentMonthKey();
    if (isClosedSnapshot(state.closedMonths[key])) throw new Error("Reopen the current month before changing Goal Funding.");
    if (activeGoalFundingCycle(key)) throw new Error("Goal funding is already applied. Undo it before applying a replacement.");
    const totalAllocation = state.goals.reduce((sum, goal) => sum + goal.allocationPercent, 0);
    if (totalAllocation <= 0) throw new Error("Set a goal allocation percentage first.");
    if (totalAllocation > 100) throw new Error("Goal allocation percentages exceed 100%.");
    const pool = goalFundingPool();
    if (pool <= 0) throw new Error("No funding pool is currently available.");

    const allocations = [];
    let appliedAmount = 0;
    for (const goal of state.goals) {
      const requested = pool * (goal.allocationPercent / 100);
      const room = Math.max(0, goal.target - goal.currentAmount);
      const applied = Math.min(requested, room, pool - appliedAmount);
      if (applied <= 0) continue;
      const beforeAmount = goal.currentAmount;
      goal.currentAmount += applied;
      appliedAmount += applied;
      allocations.push({ goalId: goal.id, goalName: goal.name, amount: applied, beforeAmount, afterAmount: goal.currentAmount });
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
      legacyBalanceMutation: false
    });
    persist();
    renderActiveView();
    showToast(`${money(appliedAmount)} allocated; Available Free Cash reduced`);
  }

  function undoGoalFunding() {
    const key = currentMonthKey();
    if (isClosedSnapshot(state.closedMonths[key])) throw new Error("Reopen the current month before undoing Goal Funding.");
    const cycle = activeGoalFundingCycle(key);
    if (!cycle) throw new Error("There is no active Goal Funding to undo this month.");
    if (!confirm(`Undo ${money(cycle.appliedAmount)} of Goal Funding and restore Available Free Cash?`)) return;
    for (const allocation of cycle.allocations) {
      const goal = state.goals.find(item => item.id === allocation.goalId);
      if (!goal) throw new Error(`Cannot safely undo funding because goal “${allocation.goalName || allocation.goalId}” is missing.`);
      const expectedAfter = allocation.afterAmount;
      goal.currentAmount = expectedAfter !== null && Math.abs(goal.currentAmount - expectedAfter) < 0.01
        ? amount(allocation.beforeAmount)
        : Math.max(0, goal.currentAmount - amount(allocation.amount));
    }
    cycle.status = "undone";
    cycle.undoneAt = new Date().toISOString();
    cycle.undoReason = "Reset from current-month Goal Funding";
    persist();
    renderActiveView();
    showToast(`${money(cycle.appliedAmount)} Goal Funding undone; Available Free Cash restored`);
  }

  function openCloseReview() {
    const key = monthKeyAtOffset(ui.closeOffset);
    const existing = state.closedMonths[key];
    if (isClosedSnapshot(existing)) throw new Error("Reopen this snapshot before making a correction.");
    if (key !== currentMonthKey() && existing?.status !== "reopened") throw new Error("Only the active month or a reopened snapshot can be closed.");
    const draft = closeDraftFromInputs();
    ui.pendingCloseDraft = draft;
    byId("closeReviewDialogTitle").textContent = existing?.status === "reopened" ? "Review Corrected Monthly Close" : "Review Monthly Close";
    byId("closeReviewSummary").innerHTML = [
      ["Month", monthFormatter.format(monthDate(key))],
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
    byId("closeReviewDialog").showModal();
    requestAnimationFrame(() => byId("closeReviewConfirmed").focus());
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
      auditTrail: existing?.auditTrail ? clone(existing.auditTrail) : [],
      schemaVersion: SCHEMA_VERSION
    };
    snapshot.auditTrail.push({
      id: uid("audit"),
      event: "closed",
      at: closedAt,
      revision,
      reason: existing ? `Corrected after: ${existing.reopenReason}` : "Confirmed monthly close",
      snapshot: snapshotAuditData(snapshot)
    });
    state.closedMonths[draft.key] = snapshot;
    persist();
    byId("closeReviewDialog").close();
    ui.pendingCloseDraft = null;
    renderActiveView();
    showToast(`${monthFormatter.format(monthDate(draft.key))} closed as revision ${revision}`);
  }

  function openReopenReview() {
    const key = monthKeyAtOffset(ui.closeOffset);
    const snapshot = state.closedMonths[key];
    if (!isClosedSnapshot(snapshot)) throw new Error("Only a closed snapshot can be reopened.");
    ui.pendingReopenKey = key;
    byId("reopenDialogTitle").textContent = `Reopen ${monthFormatter.format(monthDate(key))}`;
    byId("reopenReason").value = "";
    byId("reopenDialog").showModal();
    requestAnimationFrame(() => byId("reopenReason").focus());
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
    persist();
    byId("reopenDialog").close();
    ui.pendingReopenKey = null;
    renderActiveView();
    showToast(`${monthFormatter.format(monthDate(key))} reopened; frozen revision ${snapshot.revision} remains in the audit trail`);
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
    download(`clean-planner-v11.1-${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json;charset=utf-8");
    showToast("JSON backup exported");
  }

  function exportCSV() {
    const rows = [["date", "name", "amount", "category_id", "category_label", "recurring"]];
    for (const transaction of [...state.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([transaction.date, transaction.name, transaction.amount, transaction.categoryId, transactionCategoryName(transaction), transaction.recurringTag ? "yes" : "no"]);
    }
    const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
    download(`clean-planner-v11.1-transactions-${todayISO()}.csv`, csv, "text/csv;charset=utf-8");
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

  async function importJSONFile(file) {
    if (!file) return;
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid JSON: ${cleanText(error?.message, "parse error", 130)}`);
    }
    const migrated = migrateState(parsed, { importing: true });
    state = migrated;
    persist();
    renderActiveView();
    showToast("JSON backup imported and validated");
  }

  async function importCSVFile(file) {
    if (!file) return;
    const rows = parseCSV(await file.text());
    if (rows.length < 2) throw new Error("The CSV has no transaction rows.");
    const headers = rows[0].map(header => header.trim().toLowerCase());
    const required = ["date", "name", "amount"];
    if (!required.every(header => headers.includes(header))) throw new Error("CSV requires date, name, and amount columns.");
    const index = name => headers.indexOf(name);
    let added = 0;
    let skipped = 0;
    for (const row of rows.slice(1)) {
      const date = row[index("date")]?.trim();
      const name = cleanText(row[index("name")], "", 80).replace(/^'/, "");
      const transactionAmount = amount(row[index("amount")]);
      if (!isISODate(date) || !name || transactionAmount <= 0) {
        skipped += 1;
        continue;
      }
      const rawCategoryId = index("category_id") >= 0 ? cleanText(row[index("category_id")], "other", 70) : "";
      const rawCategoryLabel = index("category_label") >= 0 ? cleanText(row[index("category_label")], "Other", 80).replace(/^'/, "") : "Other";
      const byName = state.categories.find(category => category.name.toLowerCase() === rawCategoryLabel.toLowerCase());
      const categoryId = state.categories.some(category => category.id === rawCategoryId) ? rawCategoryId : byName?.id || "other";
      const recurring = index("recurring") >= 0 && /^(yes|true|1)$/i.test(row[index("recurring")]?.trim());
      state.transactions.push({ id: uid("transaction"), name, amount: transactionAmount, categoryId, categoryLabel: rawCategoryLabel, date, recurringId: null, recurringTag: recurring, createdAt: new Date().toISOString() });
      added += 1;
    }
    if (!added) throw new Error("No valid transaction rows were found in the CSV.");
    persist();
    showToast(`Imported ${added} transaction${added === 1 ? "" : "s"}${skipped ? `; skipped ${skipped} invalid row${skipped === 1 ? "" : "s"}` : ""}`);
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
      case "delete-transaction": deleteTransaction(id); break;
      case "open-recurring": openDialog("recurringDialog", "create"); break;
      case "edit-recurring": openDialog("recurringDialog", "edit", id); break;
      case "delete-recurring": deleteRecurring(id); break;
      case "pay-recurring": payRecurring(id); break;
      case "open-goal": openDialog("goalDialog", "create"); break;
      case "edit-goal": openDialog("goalDialog", "edit", id); break;
      case "delete-goal": deleteGoal(id); break;
      case "balance-goals": balanceGoalAllocations(); break;
      case "apply-goal-funding": applyGoalFunding(); break;
      case "undo-goal-funding": undoGoalFunding(); break;
      case "open-category": openDialog("categoryDialog", "create"); break;
      case "edit-category": openDialog("categoryDialog", "edit", id); break;
      case "delete-category": deleteCategory(id); break;
      case "save-category-plan": saveCategoryPlan(id); break;
      case "calendar-prev": ui.calendarOffset -= 1; renderActiveView(); break;
      case "calendar-next": ui.calendarOffset += 1; renderActiveView(); break;
      case "save-opening-balance": saveOpeningBalance(); break;
      case "close-prev": ui.closeOffset -= 1; renderActiveView(); break;
      case "close-next": ui.closeOffset = Math.min(0, ui.closeOffset + 1); renderActiveView(); break;
      case "review-close-month": openCloseReview(); break;
      case "open-reopen-review": openReopenReview(); break;
      case "save-settings": saveSettings(); break;
      case "export-json": exportJSON(); break;
      case "import-json": byId("jsonFileInput").click(); break;
      case "export-csv": exportCSV(); break;
      case "import-csv": byId("csvFileInput").click(); break;
      case "install-app": void installApp(); break;
      case "close-dialog": closeDialogFrom(control); break;
      default: throw new Error(`Unknown action: ${action}`);
    }
  }

  function attachEvents() {
    byId("closeReviewDialog").addEventListener("cancel", () => { ui.pendingCloseDraft = null; });
    byId("reopenDialog").addEventListener("cancel", () => { ui.pendingReopenKey = null; });
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
      safely(() => {
        if (event.target.id === "transactionForm") saveTransaction();
        else if (event.target.id === "recurringForm") saveRecurring();
        else if (event.target.id === "goalForm") saveGoal();
        else if (event.target.id === "categoryForm") saveCategory();
        else if (event.target.id === "closeReviewForm") commitCloseMonth();
        else if (event.target.id === "reopenForm") reopenSnapshot();
        else throw new Error("Unknown form submission.");
      });
    });

    document.addEventListener("input", event => {
      if (event.target.id === "transactionSearch") {
        ui.transactionSearch = event.target.value;
        safely(renderTransactions);
      } else if (["closeBaseIncomeInput", "closeOtIncomeInput", "closeActualSaving", "closeActualInvestment", "closeSalaryDayInput", "closeBalanceInput"].includes(event.target.id)) {
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

  function initialize() {
    attachEvents();
    const requestedView = location.hash.slice(1);
    if (VIEW_IDS.has(requestedView)) ui.activeView = requestedView;
    if (runtime.migrationMessage || !state.meta.updatedAt) persist();
    renderApp();
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

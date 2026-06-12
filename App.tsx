import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  StatusBar,
} from "react-native";

import { NavigationBar } from "expo-navigation-bar";

import AsyncStorage from "@react-native-async-storage/async-storage";

type TabKey = "dashboard" | "ports" | "batteries" | "groups" | "log" | "settings";

type BatteryStatus = "out" | "idle" | "ready" | "charging" | "topping" | "full";

type Battery = {
  id: number;
  groupId: string | null;
  totalChargedSec: number;
  currentPortId: number | null;
  sessionStartMs: number | null;
  lastChargedAtMs: number | null;
  removedCount: number;
};

type Port = {
  id: number;
  amps: number;
  batteryId: number | null;
  assignedAtMs: number | null;
};

type Group = {
  id: string;
  name: string;
  targetSec: number;
  notify: boolean;
  color: string;
  memberIds: number[];
};

type LogEntry = {
  id: string;
  type: "assigned" | "removed" | "completed" | "group" | "settings";
  title: string;
  detail: string;
  timeMs: number;
};

const TAB_ORDER: TabKey[] = ["dashboard", "ports", "batteries", "groups", "log", "settings"];

const PALETTE = [
  { bg: "#E6F1FB", fg: "#185FA5" },
  { bg: "#E1F5EE", fg: "#0F6E56" },
  { bg: "#FAEEDA", fg: "#854F0B" },
  { bg: "#FCEBEB", fg: "#A32D2D" },
  { bg: "#F1EFE8", fg: "#5F5E5A" },
  { bg: "#F1EAFE", fg: "#6A3DA8" },
];

const nowMs = () => Date.now();

const INITIAL_TOTALS: Record<number, number> = {
  // 1: 4 * 3600 + 22 * 60,
  // 2: 6 * 3600 + 5 * 60,
  // 3: 3 * 3600 + 18 * 60,
  // 7: 2 * 3600 + 54 * 60,
  // 11: 5 * 3600 + 33 * 60,
};

const INITIAL_PORTS: Record<number, number> = {
  // 3: 2,
  // 7: 1,
  // 11: 3,
};

const INITIAL_SESSION_OFFSETS_MS: Record<number, number> = {
  // 3: 58 * 60 * 1000,
  // 7: 102 * 60 * 1000,
  // 11: 130 * 60 * 1000,
};

const STORAGE_KEY = "frc-battery-manager-state";
const HAS_SEEN_ONBOARDING_KEY = "frc-battery-manager-seeded";

function createInitialBatteries(count: number): Battery[] {
  const membersA = new Set([1, 4, 7, 9, 11]);
  const membersB = new Set([2, 3, 6, 10]);
  const membersC = new Set([5, 8, 12]);

  return Array.from({ length: count }, (_, i) => {
    const id = i + 1;
    let groupId: string | null = null;
    if (membersA.has(id)) groupId = "group-a";
    if (membersB.has(id)) groupId = "group-b";
    if (membersC.has(id)) groupId = "group-c";

    return {
      id,
      groupId,
      totalChargedSec: INITIAL_TOTALS[id] ?? 0,
      currentPortId: INITIAL_PORTS[id] ?? null,
      sessionStartMs: INITIAL_SESSION_OFFSETS_MS[id] ? nowMs() - INITIAL_SESSION_OFFSETS_MS[id] : null,
      lastChargedAtMs: INITIAL_TOTALS[id] ? nowMs() - 2 * 60 * 60 * 1000 : null,
      removedCount: [1, 11].includes(id) ? 1 : 0,
    };
  });
}

function createInitialPorts(): Port[] {
  return [
    // { id: 1, amps: 6, batteryId: 7, assignedAtMs: nowMs() - 102 * 60 * 1000 },
    // { id: 2, amps: 6, batteryId: 3, assignedAtMs: nowMs() - 58 * 60 * 1000 },
    // { id: 3, amps: 6, batteryId: 11, assignedAtMs: nowMs() - 130 * 60 * 1000 },
    // { id: 4, amps: 6, batteryId: null, assignedAtMs: null },
  ];
}

function createInitialGroups(): Group[] {
  return [
    // {
    //   id: "group-a",
    //   name: "Competition batteries",
    //   targetSec: parseTimeInput("2h 30m"),
    //   notify: true,
    //   color: PALETTE[0].bg,
    //   memberIds: [1, 4, 7, 9, 11],
    // },
    // {
    //   id: "group-b",
    //   name: "Practice batteries",
    //   targetSec: parseTimeInput("1h 45m"),
    //   notify: true,
    //   color: PALETTE[1].bg,
    //   memberIds: [2, 3, 6, 10],
    // },
    // {
    //   id: "group-c",
    //   name: "Backup / testing",
    //   targetSec: parseTimeInput("3h 00m"),
    //   notify: false,
    //   color: PALETTE[2].bg,
    //   memberIds: [5, 8, 12],
    // },
  ];
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseTimeInput(value: string): number {
  const raw = value.trim().toLowerCase();
  if (!raw) return 0;

  const hm = raw.match(/(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m?)?/i);
  if (hm) {
    const hours = hm[1] ? Number(hm[1]) : 0;
    const mins = hm[2] ? Number(hm[2]) : 0;
    if (!Number.isNaN(hours) || !Number.isNaN(mins)) {
      return Math.max(0, Math.round(hours * 3600 + mins * 60));
    }
  }

  if (/^\d+$/.test(raw)) {
    return Number(raw) * 60;
  }

  return 0;
}

function formatDuration(sec: number) {
  const safe = Math.max(0, Math.floor(sec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function formatShort(sec: number) {
  const safe = Math.max(0, Math.floor(sec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatClock(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function batteryGroupName(groups: Group[], battery: Battery) {
  return groups.find((g) => g.id === battery.groupId)?.name ?? "Unassigned";
}

function batteryGroup(groups: Group[], battery: Battery) {
  return groups.find((g) => g.id === battery.groupId) ?? null;
}

function currentSessionSec(battery: Battery, now: number) {
  if (battery.currentPortId == null || battery.sessionStartMs == null) return 0;
  return Math.max(0, Math.floor((now - battery.sessionStartMs) / 1000));
}

function effectiveChargeSec(battery: Battery, now: number) {
  return battery.totalChargedSec + currentSessionSec(battery, now);
}

function batteryTargetSec(groups: Group[], battery: Battery) {
  const grp = batteryGroup(groups, battery);
  return grp?.targetSec ?? parseTimeInput("2h 00m");
}

function batteryStatus(groups: Group[], battery: Battery, now: number): BatteryStatus {
  const target = batteryTargetSec(groups, battery);
  const total = effectiveChargeSec(battery, now);

  if (battery.currentPortId != null) {
    if (total >= target) return "full";
    if (total >= target * 0.9) return "topping";
    return "charging";
  }

  if (total >= target) return "ready";
  if (battery.totalChargedSec > 0) return "idle";
  return "out";
}

function statusLabel(status: BatteryStatus) {
  switch (status) {
    case "out":
      return "Out";
    case "idle":
      return "Idle";
    case "ready":
      return "Ready";
    case "charging":
      return "Charging";
    case "topping":
      return "Topping off";
    case "full":
      return "Full";
  }
}

function statusTone(status: BatteryStatus) {
  switch (status) {
    case "full":
      return styles.badgeGreen;
    case "ready":
      return styles.badgeGreen;
    case "charging":
      return styles.badgeBlue;
    case "topping":
      return styles.badgeAmber;
    case "idle":
      return styles.badgeGray;
    case "out":
      return styles.badgeGray;
  }
}

function statusDotColor(status: BatteryStatus) {
  switch (status) {
    case "full":
    case "ready":
      return "#1D9E75";
    case "charging":
      return "#378ADD";
    case "topping":
      return "#EF9F27";
    case "idle":
      return "#888780";
    case "out":
      return "#E24B4A";
  }
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [now, setNow] = useState(nowMs());

  const [batteries, setBatteries] = useState<Battery[]>([]);
  const [ports, setPorts] = useState<Port[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const [batteryInput, setBatteryInput] = useState("");
  const [selectedPortId, setSelectedPortId] = useState<number>(0);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [groupTargetInput, setGroupTargetInput] = useState("");
  const [groupNotify, setGroupNotify] = useState(true);
  const [assignGroupId, setAssignGroupId] = useState<string>("group-a");
  const [groupBatteryInput, setGroupBatteryInput] = useState("");
  const [batteryFilter, setBatteryFilter] = useState<
  "all" | "charging" | "topping" | "full" | "ready" | "idle" | "out"
>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(nowMs()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    NavigationBar.setHidden(true);
  }, []);

  useEffect(() => {
  const load = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);

      if (raw) {
        const saved = JSON.parse(raw);

        setBatteries(saved.batteries ?? []);
        setPorts(saved.ports ?? Array.from({ length: 0 }, (_, i) => ({
          id: i + 1,
          amps: 0,
          batteryId: null,
        })));
        setGroups(saved.groups ?? []);
        setLogs(saved.logs ?? []);
        setBatteryFilter(saved.batteryFilter ?? "all");
      } else {
        setPorts([]);
        setBatteries([]);
        setGroups([]);
        setLogs([]);
      }
    } finally {
      setHydrated(true);
    }
  };

  load();
}, []);

useEffect(() => {
  if (!hydrated) return;

  AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      batteries,
      ports,
      groups,
      logs,
      batteryFilter,
    })
  );
}, [hydrated, batteries, ports, groups, logs, batteryFilter]);
  

  const augmentedBatteries = useMemo(
    () =>
      batteries.map((battery) => {
        const status = batteryStatus(groups, battery, now);
        const target = batteryTargetSec(groups, battery);
        const eff = effectiveChargeSec(battery, now);
        const pct = target > 0 ? clamp((eff / target) * 100, 0, 100) : 0;
        return { ...battery, status, target, eff, pct };
      }),
    [batteries, groups, now],
  );

  const activePorts = useMemo(() => {
    return ports.map((port) => {
      const battery = batteries.find((b) => b.id === port.batteryId) ?? null;
      return { ...port, battery };
    });
  }, [ports, batteries]);

  const stats = useMemo(() => {
    const total = batteries.length;
    const charging = augmentedBatteries.filter((b) => b.currentPortId != null).length;
    const full = augmentedBatteries.filter((b) => b.status === "full" || b.status === "ready").length;
    const out = augmentedBatteries.filter((b) => b.status === "out").length;
    const inUse = charging;
    const idle = Math.max(0, total - charging - full - out);

    return { total, charging, full, out, inUse, idle };
  }, [augmentedBatteries, batteries.length]);

  function pushLog(type: LogEntry["type"], title: string, detail: string) {
    setLogs((prev) => [{ id: uid("log"), type, title, detail, timeMs: nowMs() }, ...prev]);
  }

  function updateBattery(batteryId: number, updater: (battery: Battery) => Battery) {
    setBatteries((prev) => prev.map((battery) => (battery.id === batteryId ? updater(battery) : battery)));
  }

  function updatePort(portId: number, updater: (port: Port) => Port) {
    setPorts((prev) => prev.map((port) => (port.id === portId ? updater(port) : port)));
  }

  function removeBatteryFromPort(portId: number, reason: "removed" | "reassigned" = "removed") {
    const port = ports.find((p) => p.id === portId);
    if (!port || port.batteryId == null) return;

    const battery = batteries.find((b) => b.id === port.batteryId);
    if (!battery) return;

    const sessionSec = battery.currentPortId != null ? currentSessionSec(battery, now) : 0;
    const total = battery.totalChargedSec + sessionSec;
    const groupName = batteryGroupName(groups, battery);

    updateBattery(battery.id, (b) => ({
      ...b,
      totalChargedSec: total,
      currentPortId: null,
      sessionStartMs: null,
      lastChargedAtMs: now,
      removedCount: b.removedCount + (reason === "removed" ? 1 : 0),
    }));

    updatePort(portId, (p) => ({ ...p, batteryId: null, assignedAtMs: null }));

    const reached = total >= batteryTargetSec(groups, battery);
    pushLog(
      reason === "removed" ? "removed" : "assigned",
      `Battery #${String(battery.id).padStart(2, "0")} ${reason === "removed" ? "removed from" : "moved off"} Port ${portId}`,
      `${reason === "removed" ? "Sent to field" : "Cleared for reassignment"} · ${groupName} · ${formatShort(total)} total${reached ? " · target met" : ""}`,
    );
  }

  const confirmFactoryReset = () => {
  Alert.alert(
    "Factory Reset",
    "This will delete all batteries, groups, charging history, and settings. This cannot be undone.",
    [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Reset",
        style: "destructive",
        onPress: () => factoryReset(),
      },
    ]
  );
};

  const factoryReset = async () => {
  await AsyncStorage.removeItem(STORAGE_KEY);

  const emptyPorts = Array.from({ length: 0 }, (_, i) => ({
    id: i + 1,
    amps: 6,
    batteryId: null,
  }));

  setBatteries([]);
  setPorts([]);
  setGroups([]);
  setLogs([]);
  setBatteryFilter("all");
};

  function assignBatteryToPort(batteryId: number, portId: number) {
    const battery = batteries.find((b) => b.id === batteryId);
    const port = ports.find((p) => p.id === portId);
    if (!battery || !port) return;

    if (battery.currentPortId != null && battery.currentPortId !== portId) {
      removeBatteryFromPort(battery.currentPortId, "reassigned");
    }

    if (port.batteryId != null && port.batteryId !== batteryId) {
      removeBatteryFromPort(portId, "reassigned");
    }

    const assignmentNow = nowMs();

    updateBattery(batteryId, (b) => ({
  ...b,
  totalChargedSec: 0,
  currentPortId: portId,
  sessionStartMs: assignmentNow,
  lastChargedAtMs: null,
}));

    updatePort(portId, (p) => ({
      ...p,
      batteryId,
      assignedAtMs: assignmentNow,
    }));

    const group = batteryGroup(groups, battery);
    pushLog(
      "assigned",
      `Battery #${String(batteryId).padStart(2, "0")} assigned to Port ${portId}`,
      `${group?.name ?? "Unassigned"} · ${port.amps}A · charge started`,
    );
  }

  function onQuickAssign() {
    const batteryId = Number(batteryInput);
    if (!Number.isFinite(batteryId) || batteryId < 1) {
      Alert.alert("Invalid battery number", "Enter a valid battery number.");
      return;
    }
    if (batteryId > batteries.length) {
      Alert.alert("Battery not found", `Battery #${batteryId} does not exist yet. Increase the total battery count first.`);
      return;
    }
    assignBatteryToPort(batteryId, selectedPortId);
  }

  function addBatteryCount(delta: number) {
    setBatteries((prev) => {
      const nextCount = clamp(prev.length + delta, 1, 128);
      if (nextCount === prev.length) return prev;

      if (nextCount > prev.length) {
        const additions = Array.from({ length: nextCount - prev.length }, (_, idx) => {
          const id = prev.length + idx + 1;
          return {
            id,
            groupId: null,
            totalChargedSec: 0,
            currentPortId: null,
            sessionStartMs: null,
            lastChargedAtMs: null,
            removedCount: 0,
          } satisfies Battery;
        });
        return [...prev, ...additions];
      }

      const keepIds = new Set(Array.from({ length: nextCount }, (_, i) => i + 1));
      const removedIds = prev.filter((b) => !keepIds.has(b.id)).map((b) => b.id);

      removedIds.forEach((id) => {
        const battery = prev.find((b) => b.id === id);
        if (battery?.currentPortId != null) {
          updatePort(battery.currentPortId, (p) => ({ ...p, batteryId: null, assignedAtMs: null }));
        }
      });

      if (removedIds.length > 0) {
        setGroups((gprev) =>
          gprev.map((g) => ({
            ...g,
            memberIds: g.memberIds.filter((id) => keepIds.has(id)),
          })),
        );

        setPorts((pPrev) =>
          pPrev.map((port) =>
            port.batteryId != null && !keepIds.has(port.batteryId)
              ? { ...port, batteryId: null, assignedAtMs: null }
              : port,
          ),
        );

        pushLog("settings", "Battery count reduced", `Removed ${removedIds.length} battery(s) from the roster`);
      }

      return prev
        .filter((b) => keepIds.has(b.id))
        .map((battery) => ({
          ...battery,
          groupId: keepIds.has(battery.id) ? battery.groupId : null,
        }));
    });
  }

  function addPortCount(delta: number) {
    setPorts((prev) => {
      const nextCount = clamp(prev.length + delta, 1, 16);
      if (nextCount === prev.length) return prev;

      if (nextCount > prev.length) {
        const additions = Array.from({ length: nextCount - prev.length }, (_, idx) => ({
          id: prev.length + idx + 1,
          amps: prev[prev.length - 1]?.amps ?? 6,
          batteryId: null,
          assignedAtMs: null,
        }));
        pushLog("settings", "Ports added", `Added ${additions.length} new charger port(s)`);
        return [...prev, ...additions];
      }

      const removed = prev.filter((p) => p.id > nextCount);
      removed.forEach((port) => {
        if (port.batteryId != null) {
          const battery = batteries.find((b) => b.id === port.batteryId);
          if (battery) {
            updateBattery(battery.id, (b) => ({
              ...b,
              totalChargedSec: b.totalChargedSec + currentSessionSec(b, now),
              currentPortId: null,
              sessionStartMs: null,
              lastChargedAtMs: now,
            }));
          }
        }
      });

      setBatteries((bprev) =>
        bprev.map((battery) =>
          removed.some((port) => port.batteryId === battery.id)
            ? { ...battery, currentPortId: null, sessionStartMs: null, lastChargedAtMs: now }
            : battery,
        ),
      );
      pushLog("settings", "Ports removed", `Removed ${removed.length} charger port(s)`);
      return prev.filter((p) => p.id <= nextCount);
    });
  }

  function changePortAmps(portId: number, value: string) {
    const amps = Math.max(1, Number(value) || 1);
    setPorts((prev) => prev.map((p) => (p.id === portId ? { ...p, amps } : p)));
  }

  function createGroup() {
    const targetSec = parseTimeInput(groupTargetInput);
    if (!groupNameInput.trim()) {
      Alert.alert("Missing group name", "Enter a name for the new group.");
      return;
    }
    if (targetSec <= 0) {
      Alert.alert("Invalid target time", "Use a time like 2h 30m or 90m.");
      return;
    }

    const colorIndex = groups.length % PALETTE.length;
    const id = uid("group");
    const group: Group = {
      id,
      name: groupNameInput.trim(),
      targetSec,
      notify: groupNotify,
      color: PALETTE[colorIndex].bg,
      memberIds: [],
    };
    setGroups((prev) => [...prev, group]);
    setAssignGroupId(id);
    pushLog("group", `Group created: ${group.name}`, `Target ${formatDuration(targetSec)} · notifications ${groupNotify ? "on" : "off"}`);
  }

  function deleteGroup(groupId: string) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    Alert.alert("Delete group?", `Remove ${group.name}? Batteries in this group will become unassigned.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setGroups((prev) => prev.filter((g) => g.id !== groupId));
          setBatteries((prev) => prev.map((b) => (b.groupId === groupId ? { ...b, groupId: null } : b)));
          pushLog("group", `Group deleted: ${group.name}`, "Batteries from this group were unassigned");
        },
      },
    ]);
  }

  function addBatteryToGroup(groupId: string, batteryId: number) {
    if (!batteries.some((b) => b.id === batteryId)) {
      Alert.alert("Battery not found", `Battery #${batteryId} does not exist.`);
      return;
    }
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              memberIds: Array.from(new Set([...g.memberIds, batteryId])),
            }
          : g,
      ),
    );
    setBatteries((prev) => prev.map((b) => (b.id === batteryId ? { ...b, groupId } : b)));
    const group = groups.find((g) => g.id === groupId);
    pushLog("group", `Battery #${String(batteryId).padStart(2, "0")} added to group`, group?.name ?? "Group updated");
  }

  function removeBatteryFromGroup(groupId: string, batteryId: number) {
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, memberIds: g.memberIds.filter((id) => id !== batteryId) } : g)),
    );
    setBatteries((prev) => prev.map((b) => (b.id === batteryId ? { ...b, groupId: null } : b)));
    pushLog("group", `Battery #${String(batteryId).padStart(2, "0")} removed from group`, "Battery is now unassigned");
  }

  function updateGroupTarget(groupId: string, value: string) {
    const sec = parseTimeInput(value);
    if (sec <= 0) return;
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, targetSec: sec } : g)));
  }

  function exportCsv() {
    const header = ["battery,group,status,total_charged,last_charged,port,removed_count"];
    const rows = augmentedBatteries.map((b) => {
      const port = b.currentPortId ? `Port ${b.currentPortId}` : "";
      const last = b.lastChargedAtMs ? formatDateTime(b.lastChargedAtMs) : "";
      return [
        `#${String(b.id).padStart(2, "0")}`,
        batteryGroupName(groups, b),
        statusLabel(b.status),
        formatDuration(b.eff),
        last,
        port,
        b.removedCount,
      ].join(",");
    });
    const csv = [...header, ...rows].join("\n");
    Alert.alert("CSV export ready", csv.slice(0, 900) + (csv.length > 900 ? "\n…" : ""));
  }

  const filteredBatteries = useMemo(() => {
    const groupId = groupFilter === "all" ? null : groupFilter;
    return augmentedBatteries.filter((battery) => {
      const statusMatch = batteryFilter === "all" ? true : battery.status === batteryFilter;
      const groupMatch = groupId ? battery.groupId === groupId : true;
      return statusMatch && groupMatch;
    });
  }, [augmentedBatteries, batteryFilter, groupFilter]);

  const topPorts = activePorts;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar hidden />
      <View style={styles.container}>
        <View style={styles.tabBar}>
          {TAB_ORDER.map((tab) => {
            const active = activeTab === tab;
            return (
              <Pressable key={tab} onPress={() => setActiveTab(tab)} style={[styles.tab, active && styles.tabActive]}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {tab === "dashboard" && "Dashboard"}
                  {tab === "ports" && "Ports"}
                  {tab === "batteries" && "Batteries"}
                  {tab === "groups" && "Groups"}
                  {tab === "log" && "Activity"}
                  {tab === "settings" && "Settings"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {activeTab === "dashboard" && (
            <View>
              <Text style={styles.title}>FRC Battery Manager</Text>
              <Text style={styles.subtitle}>
                Manage battery counts, charger ports, group targets, charging sessions, and removal history.
              </Text>

              <View style={styles.statGrid}>
                <StatCard value={stats.total} label="Total batteries" />
                <StatCard value={stats.full} label="Fully charged" accent="#1D9E75" />
                <StatCard value={stats.charging} label="Currently charging" accent="#EF9F27" />
                <StatCard value={stats.out} label="Idle / out" accent="#888780" />
              </View>

              <View style={styles.duoGrid}>
                <Panel title="Active ports" subtitle={`${ports.length} ports · live status`}>
                  <View style={styles.portGrid}>
                    {topPorts.map((port) => (
                      <PortCard key={port.id} port={port} battery={port.batteryId ? batteries.find((b) => b.id === port.batteryId) ?? null : null} groups={groups} now={now} onRemove={() => removeBatteryFromPort(port.id)} />
                    ))}
                  </View>
                </Panel>

                <Panel title="Battery overview" subtitle="Current charge and status">
                  {augmentedBatteries.slice(0, 7).map((battery) => (
                    <BatteryRow
                      key={battery.id}
                      battery={battery}
                      groupName={batteryGroupName(groups, battery)}
                      now={now}
                      compact
                    />
                  ))}
                  <Pressable onPress={() => setActiveTab("batteries")} style={styles.linkRow}>
                    <Text style={styles.linkText}>View all batteries →</Text>
                  </Pressable>
                </Panel>
              </View>
            </View>
          )}

          {activeTab === "ports" && (
            <View>
              <SectionHeader title="Ports" rightText={`${ports.length} available ports`} />
              <Panel
                title="Quick assign"
                subtitle="Assign any battery number to any port"
                rightAction={<Pressable style={styles.primaryButton} onPress={onQuickAssign}><Text style={styles.primaryButtonText}>Assign</Text></Pressable>}
              >
                <View style={styles.assignRow}>
                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>Battery #</Text>
                    <TextInput
                      value={batteryInput}
                      onChangeText={setBatteryInput}
                      keyboardType="number-pad"
                      placeholder="e.g. 05"
                      style={styles.textInput}
                      placeholderTextColor="#8B8E96"
                    />
                  </View>

                  <View style={styles.fieldBlockGrow}>
                    <Text style={styles.fieldLabel}>Port</Text>
                    <View style={styles.chipRow}>
                      {ports.map((port) => {
                        const selected = selectedPortId === port.id;
                        const occupied = port.batteryId != null;
                        return (
                          <Pressable
                            key={port.id}
                            onPress={() => setSelectedPortId(port.id)}
                            style={[styles.portChip, selected && styles.portChipSelected, occupied && styles.portChipOccupied]}
                          >
                            <Text style={[styles.portChipText, selected && styles.portChipTextSelected]}>
                              Port {port.id}{occupied ? " • full" : ""}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                </View>

                <View style={styles.helperNote}>
                  <Text style={styles.helperNoteText}>
                    If a port is occupied, the current battery is logged as removed before the new one is assigned.
                  </Text>
                </View>
              </Panel>

              <View style={styles.portGridLarge}>
  {ports.map((port) => {
    const battery = batteries.find((b) => b.id === port.batteryId) ?? null;

    const eff = battery ? effectiveChargeSec(battery, now) : 0;
    const target = battery ? batteryTargetSec(groups, battery) : 1;
    const status = battery ? batteryStatus(groups, battery, now) : "out";
    const progressPct = battery ? Math.min(100, (eff / Math.max(1, target)) * 100) : 0;

    return (
      <View key={port.id} style={[styles.portCard, battery && styles.portCardOccupied]}>
        <View style={styles.portCardHeader}>
          <Text style={styles.portNumber}>Port {port.id}</Text>
          <Badge
            label={
              battery
                ? status === "topping"
                  ? "Topping off"
                  : status === "full"
                    ? "Full"
                    : "Charging"
                : "Empty"
            }
            tone={battery ? status : "out"}
          />
        </View>

        <Text style={styles.portBattery}>
          {battery ? `#${String(battery.id).padStart(2, "0")}` : "—"}
        </Text>

        <Text style={styles.portMeta}>
          {battery ? `${batteryGroupName(groups, battery)} · ${port.amps}A` : `${port.amps}A available`}
        </Text>

        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${progressPct}%`,
                backgroundColor: battery ? progressColor(status) : "#378ADD",
              },
            ]}
          />
        </View>

        <View style={styles.portFooter}>
          <Text style={styles.mutedText}>
            {battery ? `${formatDuration(eff)} elapsed` : "No battery assigned"}
          </Text>
          <Text style={styles.mutedText}>
            {battery ? `${Math.round(progressPct)}%` : ""}
          </Text>
        </View>

        <View style={styles.cardActionRow}>
          {battery ? (
            <>
              <Pressable style={styles.removeButton} onPress={() => removeBatteryFromPort(port.id)}>
                <Text style={styles.removeButtonText}>Remove</Text>
              </Pressable>

              <Pressable
                style={styles.ghostButton}
                onPress={() =>
                  Alert.alert(
                    "History",
                    `Battery #${String(battery.id).padStart(2, "0")} has been charged for ${formatDuration(eff)} total.`
                  )
                }
              >
                <Text style={styles.ghostButtonText}>History</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={styles.primaryButton} onPress={onQuickAssign}>
              <Text style={styles.primaryButtonText}>Assign battery</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  })}
</View>
            </View>
          )}

          {activeTab === "batteries" && (
            <View>
              <SectionHeader title="Batteries" rightText={`${filteredBatteries.length} shown`} />
              <Panel
                title="Filters"
                subtitle="Search by battery status or group"
                rightAction={<View />}
              >
                <View style={styles.chipRowWrap}>
                  {(["all", "charging", "topping", "full", "ready", "idle", "out"] as const).map((s) => (
                    <Pressable key={s} onPress={() => setBatteryFilter(s)} style={[styles.filterChip, batteryFilter === s && styles.filterChipSelected]}>
                      <Text style={[styles.filterChipText, batteryFilter === s && styles.filterChipTextSelected]}>
                        {s === "all" ? "All" : statusLabel(s)}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View style={[styles.chipRowWrap, { marginTop: 10 }]}>
                  <Pressable onPress={() => setGroupFilter("all")} style={[styles.groupFilterChip, groupFilter === "all" && styles.groupFilterChipSelected]}>
                    <Text style={[styles.filterChipText, groupFilter === "all" && styles.filterChipTextSelected]}>All groups</Text>
                  </Pressable>
                  {groups.map((group) => (
                    <Pressable key={group.id} onPress={() => setGroupFilter(group.id)} style={[styles.groupFilterChip, groupFilter === group.id && styles.groupFilterChipSelected]}>
                      <Text style={[styles.filterChipText, groupFilter === group.id && styles.filterChipTextSelected]}>{group.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </Panel>

              <Panel title="Roster" subtitle="Every battery in the system">
                <View style={styles.tableHeader}>
                  <Text style={styles.tableHeadCellSmall}>#</Text>
                  <Text style={styles.tableHeadCellGroup}>Group</Text>
                  <Text style={styles.tableHeadCellStatus}>Status</Text>
                  <Text style={styles.tableHeadCell}>Charged</Text>
                  <Text style={styles.tableHeadCell}>Last charged</Text>
                  <Text style={styles.tableHeadCell}>Port</Text>
                </View>

                {filteredBatteries.map((battery) => (
                  <BatteryRow key={battery.id} battery={battery} groupName={batteryGroupName(groups, battery)} now={now} />
                ))}
              </Panel>
            </View>
          )}

          {activeTab === "groups" && (
            <View>
              <SectionHeader title="Groups" rightText="Manage charge targets and membership" />
              <View style={styles.duoGrid}>
                <Panel title="Create a group" subtitle="Add a new battery group">
                  <Text style={styles.fieldLabel}>Group name</Text>
                  <TextInput value={groupNameInput} onChangeText={setGroupNameInput} style={styles.textInput} placeholderTextColor="#8B8E96" />
                  <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Target charge time</Text>
                  <TextInput value={groupTargetInput} onChangeText={setGroupTargetInput} style={styles.textInput} placeholder="2h 30m" placeholderTextColor="#8B8E96" />
                  <View style={styles.toggleRow}>
                    <Text style={styles.mutedText}>Notify when target is exceeded</Text>
                    <Pressable onPress={() => setGroupNotify((v) => !v)} style={[styles.togglePill, groupNotify && styles.togglePillOn]}>
                      <Text style={[styles.togglePillText, groupNotify && styles.togglePillTextOn]}>{groupNotify ? "On" : "Off"}</Text>
                    </Pressable>
                  </View>
                  <Pressable style={[styles.primaryButton, { alignSelf: "flex-start", marginTop: 12 }]} onPress={createGroup}>
                    <Text style={styles.primaryButtonText}>Create group</Text>
                  </Pressable>
                </Panel>

                <Panel title="Move a battery" subtitle="Assign a battery to a different group">
                  <Text style={styles.fieldLabel}>Battery #</Text>
                  <TextInput value={groupBatteryInput} onChangeText={setGroupBatteryInput} style={styles.textInput} keyboardType="number-pad" placeholder="e.g. 08" placeholderTextColor="#8B8E96" />
                  <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Target group</Text>
                  <View style={styles.chipRowWrap}>
                    {groups.map((group) => (
                      <Pressable key={group.id} onPress={() => setAssignGroupId(group.id)} style={[styles.groupFilterChip, assignGroupId === group.id && styles.groupFilterChipSelected]}>
                        <Text style={[styles.filterChipText, assignGroupId === group.id && styles.filterChipTextSelected]}>{group.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Pressable
                    style={[styles.primaryButton, { alignSelf: "flex-start", marginTop: 12 }]}
                    onPress={() => addBatteryToGroup(assignGroupId, Number(groupBatteryInput))}
                  >
                    <Text style={styles.primaryButtonText}>Add to group</Text>
                  </Pressable>
                </Panel>
              </View>

              {groups.map((group) => {
                const members = group.memberIds
                  .map((id) => batteries.find((b) => b.id === id))
                  .filter(Boolean) as Battery[];
                return (
                  <View key={group.id} style={styles.groupCard}>
                    <View style={styles.groupHeader}>
                      <View style={styles.groupTitleWrap}>
                        <View style={[styles.groupPill, { backgroundColor: group.color }]}>
                          <Text style={styles.groupPillText}>{group.name}</Text>
                        </View>
                        <Text style={styles.groupSubText}>
                          {members.length} battery{members.length === 1 ? "" : "ies"} · notify {group.notify ? "on" : "off"}
                        </Text>
                      </View>
                      <View style={styles.cardActionRow}>
                        <Pressable style={styles.ghostButton} onPress={() => Alert.alert("Edit group", "Use the target time field below to change the group target.")}>
                          <Text style={styles.ghostButtonText}>Edit</Text>
                        </Pressable>
                        <Pressable style={styles.removeButton} onPress={() => deleteGroup(group.id)}>
                          <Text style={styles.removeButtonText}>Delete</Text>
                        </Pressable>
                      </View>
                    </View>

                    <View style={styles.groupTargetRow}>
                      <Text style={styles.fieldLabel}>Target charge time</Text>
                      <TextInput
                        defaultValue={formatDuration(group.targetSec)}
                        style={[styles.textInput, { minWidth: 120 }]}
                        onEndEditing={(e) => updateGroupTarget(group.id, e.nativeEvent.text)}
                        placeholder="2h 30m"
                        placeholderTextColor="#8B8E96"
                      />
                      <Text style={styles.mutedText}>Alert after target exceeded</Text>
                    </View>

                    <View style={styles.groupMembers}>
                      {members.map((battery) => (
                        <Pressable key={battery.id} onPress={() => removeBatteryFromGroup(group.id, battery.id)} style={styles.memberChip}>
                          <Text style={styles.memberChipText}>#{String(battery.id).padStart(2, "0")} ×</Text>
                        </Pressable>
                      ))}
                      <View style={styles.memberAddBlock}>
                        <TextInput
                          value={groupBatteryInput}
                          onChangeText={setGroupBatteryInput}
                          style={[styles.textInput, styles.smallInput]}
                          keyboardType="number-pad"
                          placeholder="#"
                          placeholderTextColor="#8B8E96"
                        />
                        <Pressable style={styles.dashedButton} onPress={() => addBatteryToGroup(group.id, Number(groupBatteryInput))}>
                          <Text style={styles.dashedButtonText}>Add</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {activeTab === "log" && (
            <View>
              <SectionHeader title="Activity log" rightText="History of assignments, removals, and changes" />
              <Panel
                title="Recent events"
                subtitle="The app records every major battery action"
                rightAction={<Pressable style={styles.ghostButton} onPress={exportCsv}><Text style={styles.ghostButtonText}>Export CSV</Text></Pressable>}
              >
                {logs.map((log) => (
                  <View key={log.id} style={styles.logRow}>
                    <View style={[styles.logIcon, logIconStyle(log.type)]}>
                      <Text style={styles.logIconText}>{logIconGlyph(log.type)}</Text>
                    </View>
                    <View style={styles.logBody}>
                      <Text style={styles.logTitle}>{log.title}</Text>
                      <Text style={styles.logDetail}>{log.detail}</Text>
                    </View>
                    <Text style={styles.logStamp}>{formatClock(log.timeMs)}</Text>
                  </View>
                ))}
                <Pressable style={[styles.ghostButton, { alignSelf: "center", marginTop: 12 }]} onPress={() => Alert.alert("Older entries", "This demo currently keeps the full in-session log in memory.")}>
                  <Text style={styles.ghostButtonText}>Load earlier entries</Text>
                </Pressable>
              </Panel>
            </View>
          )}

          {activeTab === "settings" && (
            <View>
              <SectionHeader title="Settings" rightText="Configure the roster and chargers" />
              <View style={styles.duoGrid}>
                <Panel title="Fleet configuration" subtitle="Set how many batteries and charger ports you have">
                  <StepperRow label="Total batteries" value={batteries.length} onMinus={() => addBatteryCount(-1)} onPlus={() => addBatteryCount(1)} />
                  <StepperRow label="Charging ports" value={ports.length} onMinus={() => addPortCount(-1)} onPlus={() => addPortCount(1)} />
                </Panel>

                <Panel title="Alerts & data" subtitle="Basic app controls for the tablet">
                  <View style={styles.switchRow}>
                    <View style={styles.switchTextWrap}>
                      <Text style={styles.switchTitle}>Alert on removal</Text>
                      <Text style={styles.switchSub}>Log and notify when a battery is removed</Text>
                    </View>
                    <Pressable style={[styles.togglePill, styles.togglePillOn]}>
                      <Text style={[styles.togglePillText, styles.togglePillTextOn]}>On</Text>
                    </Pressable>
                  </View>

                  <View style={[styles.switchRow, { marginTop: 10 }]}>
                    <View style={styles.switchTextWrap}>
                      <Text style={styles.switchTitle}>Alert when target reached</Text>
                      <Text style={styles.switchSub}>Buzzes when a battery exceeds its group target</Text>
                    </View>
                    <Pressable style={[styles.togglePill, styles.togglePillOn]}>
                      <Text style={[styles.togglePillText, styles.togglePillTextOn]}>On</Text>
                    </Pressable>
                  </View>

                  <View style={{ gap: 10, marginTop: 12 }}>
                    <Pressable style={styles.ghostButton} onPress={() => {
                      setBatteries((prev) => prev.map((b) => ({ ...b, totalChargedSec: 0, sessionStartMs: b.currentPortId ? nowMs() : null, lastChargedAtMs: null })));
                      setLogs((prev) => [{ id: uid("log"), type: "settings", title: "Timers reset", detail: "Charge timers were cleared", timeMs: nowMs() }, ...prev]);
                    }}>
                      <Text style={styles.ghostButtonText}>Reset timers</Text>
                    </Pressable>
                    <Pressable style={styles.ghostButton} onPress={exportCsv}>
                      <Text style={styles.ghostButtonText}>Export all data</Text>
                    </Pressable>
                    <Pressable style={styles.removeButton} onPress={() => confirmFactoryReset()}>
                      <Text style={styles.removeButtonText}>Factory reset</Text>
                    </Pressable>
                  </View>
                </Panel>
              </View>

              <Panel title="Port amp ratings" subtitle="Edit the output of each charger port">
                <View style={styles.portAmpGrid}>
                  {ports.map((port) => (
                    <View key={port.id} style={styles.ampRow}>
                      <Text style={styles.ampLabel}>Port {port.id}</Text>
                      <TextInput
                        value={String(port.amps)}
                        onChangeText={(v) => changePortAmps(port.id, v)}
                        keyboardType="number-pad"
                        style={[styles.textInput, styles.smallInput]}
                      />
                      <Text style={styles.mutedText}>A</Text>
                    </View>
                  ))}
                </View>
              </Panel>
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function StatCard({ value, label, accent }: { value: number; label: string; accent?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Panel({
  title,
  subtitle,
  rightAction,
  children,
}: {
  title: string;
  subtitle?: string;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.panelTitle}>{title}</Text>
          {subtitle ? <Text style={styles.panelSubtitle}>{subtitle}</Text> : null}
        </View>
        {rightAction}
      </View>
      {children}
    </View>
  );
}

function SectionHeader({ title, rightText }: { title: string; rightText?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderTitle}>{title}</Text>
      {rightText ? <Text style={styles.sectionHeaderText}>{rightText}</Text> : null}
    </View>
  );
}

function StepperRow({
  label,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  value: number;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <View style={styles.stepperRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepperLabel}>{label}</Text>
        <Text style={styles.stepperSub}>{label === "Total batteries" ? "Roster size in your battery manager" : "How many physical charging outputs are available"}</Text>
      </View>
      <View style={styles.stepper}>
        <Pressable onPress={onMinus} style={styles.stepperBtn}>
          <Text style={styles.stepperBtnText}>−</Text>
        </Pressable>
        <View style={styles.stepperValueWrap}>
          <Text style={styles.stepperValue}>{value}</Text>
        </View>
        <Pressable onPress={onPlus} style={styles.stepperBtn}>
          <Text style={styles.stepperBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: BatteryStatus }) {
  return (
    <View style={[styles.badgeBase, statusTone(tone)]}>
      <Text style={[styles.badgeText, { color: statusTextColor(tone) }]}>{label}</Text>
    </View>
  );
}

function BatteryRow({
  battery,
  groupName,
  now,
  compact,
}: {
  battery: Battery & { status?: BatteryStatus; eff?: number; target?: number; pct?: number };
  groupName: string;
  now: number;
  compact?: boolean;
}) {
  const status = battery.status ?? "out";
  const eff = battery.eff ?? effectiveChargeSec(battery, now);
  const target = battery.target ?? 0;
  const portText = battery.currentPortId ? `Port ${battery.currentPortId}` : "—";
  const statusText = statusLabel(status);

  return (
    <View style={[styles.batteryRow, compact && styles.batteryRowCompact]}>
      <Text style={styles.batteryNum}>#{String(battery.id).padStart(2, "0")}</Text>

      <View style={styles.batteryMiddle}>
        <View style={[styles.groupPillTiny, { backgroundColor: battery.groupId ? groupColorById(battery.groupId) : "#F1EFE8" }]}>
          <Text style={styles.groupPillTinyText}>{groupName}</Text>
        </View>
        <Text style={styles.batteryMetaText}>
          {battery.currentPortId ? `Port ${battery.currentPortId}` : status === "out" ? "Field / in use" : status === "ready" ? "Ready" : "Idle"}
        </Text>
      </View>

      <Text style={styles.batteryChargeText}>{formatDuration(eff)}</Text>
      {!compact ? <Text style={styles.batteryChargeText}>{formatDateTime(battery.lastChargedAtMs ?? now)}</Text> : null}
      <Text style={styles.batteryChargeText}>{portText}</Text>
      <Badge label={statusText} tone={status} />
    </View>
  );
}

function PortCard({
  port,
  battery,
  groups,
  now,
  onRemove,
}: {
  port: Port;
  battery: Battery | null;
  groups: Group[];
  now: number;
  onRemove: () => void;
}) {
  const status = battery ? batteryStatus(groups, battery, now) : "out";
  const pct = battery ? clamp((effectiveChargeSec(battery, now) / Math.max(1, batteryTargetSec(groups, battery))) * 100, 0, 100) : 0;

  return (
    <View style={[styles.portCardMini, battery ? styles.portCardMiniOccupied : null]}>
      <View style={styles.portMiniHeader}>
        <Text style={styles.portMiniNumber}>Port {port.id}</Text>
        <Badge label={battery ? (status === "topping" ? "Topping off" : status === "full" ? "Full" : "Charging") : "Empty"} tone={battery ? status : "out"} />
      </View>
      <Text style={styles.portMiniBattery}>{battery ? `#${String(battery.id).padStart(2, "0")}` : "—"}</Text>
      <Text style={styles.portMiniMeta}>{battery ? `${batteryGroupName(groups, battery)} · ${port.amps}A` : "Assign a battery"}</Text>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: battery ? progressColor(status) : "#378ADD" }]} />
      </View>
      <View style={styles.portMiniFooter}>
        <Text style={styles.mutedText}>{battery ? `${formatShort(effectiveChargeSec(battery, now))} elapsed` : `${port.amps}A available`}</Text>
        <Text style={styles.mutedText}>{battery ? `${Math.round(pct)}%` : ""}</Text>
      </View>
      <View style={styles.cardActionRow}>
        {battery ? (
          <Pressable style={styles.removeButton} onPress={onRemove}>
            <Text style={styles.removeButtonText}>Remove</Text>
          </Pressable>
        ) : (
          <Text style={styles.mutedText}>Ready for assignment</Text>
        )}
      </View>
    </View>
  );
}

function logIconGlyph(type: LogEntry["type"]) {
  switch (type) {
    case "assigned":
      return "↗";
    case "removed":
      return "↑";
    case "completed":
      return "●";
    case "group":
      return "+";
    case "settings":
      return "⚙";
  }
}

function logIconStyle(type: LogEntry["type"]) {
  switch (type) {
    case "removed":
      return styles.logRemoved;
    case "completed":
      return styles.logCompleted;
    case "assigned":
      return styles.logAssigned;
    case "group":
      return styles.logGroup;
    case "settings":
      return styles.logSettings;
  }
}

function progressColor(status: BatteryStatus) {
  switch (status) {
    case "full":
    case "ready":
      return "#1D9E75";
    case "charging":
      return "#378ADD";
    case "topping":
      return "#EF9F27";
    default:
      return "#378ADD";
  }
}

function statusTextColor(status: BatteryStatus) {
  switch (status) {
    case "full":
    case "ready":
      return "#3B6D11";
    case "charging":
      return "#185FA5";
    case "topping":
      return "#854F0B";
    case "out":
    case "idle":
      return "#5F5E5A";
  }
}

function groupColorById(id: string) {
  if (id === "group-a") return PALETTE[0].bg;
  if (id === "group-b") return PALETTE[1].bg;
  if (id === "group-c") return PALETTE[2].bg;
  return PALETTE[5].bg;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F5F7FB",
  },
  container: {
    flex: 1,
    backgroundColor: "#F5F7FB",
    paddingHorizontal: 14,
    paddingTop: 6,
  },
  tabBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 10,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E7E9EF",
  },
  tabActive: {
    backgroundColor: "#E6F1FB",
    borderColor: "#B7D4F2",
  },
  tabText: {
    fontSize: 14,
    color: "#667085",
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#185FA5",
  },
  content: {
    paddingBottom: 32,
    gap: 14,
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: "#101828",
    marginTop: 6,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: "#667085",
    lineHeight: 20,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
  },
  statCard: {
    flexGrow: 1,
    minWidth: 160,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#E7E9EF",
  },
  statValue: {
    fontSize: 28,
    fontWeight: "800",
    color: "#101828",
  },
  statLabel: {
    marginTop: 4,
    color: "#667085",
    fontSize: 13,
  },
  duoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  panel: {
    flexGrow: 1,
    flexBasis: 360,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E7E9EF",
    padding: 14,
    gap: 10,
  },
  panelHeader: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  panelTitle: {
    color: "#101828",
    fontSize: 18,
    fontWeight: "800",
  },
  panelSubtitle: {
    marginTop: 2,
    color: "#667085",
    fontSize: 13,
  },
  portGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  portCardMini: {
    flexBasis: "48%",
    minWidth: 220,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E7E9EF",
    padding: 12,
    gap: 8,
  },
  portCardMiniOccupied: {
    borderColor: "#B7E2D6",
  },
  portMiniHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  portMiniNumber: {
    fontSize: 12,
    color: "#667085",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  portMiniBattery: {
    fontSize: 28,
    fontWeight: "800",
    color: "#101828",
  },
  portMiniMeta: {
    fontSize: 12,
    color: "#667085",
  },
  progressBar: {
    height: 8,
    backgroundColor: "#EAECF0",
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  portMiniFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  mutedText: {
    color: "#667085",
    fontSize: 12,
  },
  batteryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF1F5",
  },
  batteryRowCompact: {
    paddingVertical: 8,
  },
  batteryNum: {
    width: 48,
    fontSize: 15,
    fontWeight: "800",
    color: "#101828",
  },
  batteryMiddle: {
    flex: 1,
    minWidth: 140,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  groupPillTiny: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  groupPillTinyText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#185FA5",
  },
  batteryMetaText: {
    fontSize: 12,
    color: "#667085",
  },
  batteryChargeText: {
    width: 106,
    fontSize: 12,
    color: "#344054",
  },
  linkRow: {
    alignSelf: "flex-end",
    marginTop: 8,
  },
  linkText: {
    color: "#185FA5",
    fontWeight: "700",
    fontSize: 13,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: 2,
    marginTop: 4,
  },
  sectionHeaderTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#101828",
  },
  sectionHeaderText: {
    color: "#667085",
    fontSize: 12,
  },
  assignRow: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "flex-end",
  },
  fieldBlock: {
    width: 120,
  },
  fieldBlockGrow: {
    flexGrow: 1,
    minWidth: 220,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#344054",
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#D0D5DD",
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: "#101828",
    fontSize: 15,
  },
  smallInput: {
    width: 82,
    textAlign: "center",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chipRowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  portChip: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D0D5DD",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  portChipSelected: {
    backgroundColor: "#E6F1FB",
    borderColor: "#B7D4F2",
  },
  portChipOccupied: {
    borderStyle: "dashed",
  },
  portChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#344054",
  },
  portChipTextSelected: {
    color: "#185FA5",
  },
  helperNote: {
    backgroundColor: "#F5F7FB",
    borderRadius: 14,
    padding: 12,
  },
  helperNoteText: {
    color: "#667085",
    fontSize: 12,
    lineHeight: 18,
  },
  portGridLarge: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  portCard: {
    flexGrow: 1,
    flexBasis: 320,
    minWidth: 250,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E7E9EF",
    padding: 14,
    gap: 8,
  },
  portCardOccupied: {
    borderColor: "#B7E2D6",
  },
  portCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
  },
  portNumber: {
    fontSize: 12,
    color: "#667085",
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  portBattery: {
    fontSize: 30,
    fontWeight: "800",
    color: "#101828",
  },
  portMeta: {
    fontSize: 12,
    color: "#667085",
  },
  portFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardActionRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 2,
  },
  primaryButton: {
    backgroundColor: "#378ADD",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 13,
  },
  ghostButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D0D5DD",
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostButtonText: {
    color: "#344054",
    fontWeight: "800",
    fontSize: 13,
  },
  removeButton: {
    backgroundColor: "#FCEBEB",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  removeButtonText: {
    color: "#A32D2D",
    fontWeight: "800",
    fontSize: 13,
  },
  badgeBase: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  badgeGreen: {
    backgroundColor: "#EAF3DE",
  },
  badgeAmber: {
    backgroundColor: "#FAEEDA",
  },
  badgeRed: {
    backgroundColor: "#FCEBEB",
  },
  badgeBlue: {
    backgroundColor: "#E6F1FB",
  },
  badgeGray: {
    backgroundColor: "#F1EFE8",
  },
  groupFilterChip: {
    borderWidth: 1,
    borderColor: "#D0D5DD",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  groupFilterChipSelected: {
    backgroundColor: "#E6F1FB",
    borderColor: "#B7D4F2",
  },
  filterChip: {
    borderWidth: 1,
    borderColor: "#D0D5DD",
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  filterChipSelected: {
    backgroundColor: "#E6F1FB",
    borderColor: "#B7D4F2",
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#344054",
  },
  filterChipTextSelected: {
    color: "#185FA5",
  },
  tableHeader: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF1F5",
    marginBottom: 2,
  },
  tableHeadCellSmall: {
    width: 48,
    fontSize: 11,
    fontWeight: "800",
    color: "#667085",
    textTransform: "uppercase",
  },
  tableHeadCellGroup: {
    width: 96,
    fontSize: 11,
    fontWeight: "800",
    color: "#667085",
    textTransform: "uppercase",
  },
  tableHeadCellStatus: {
    flex: 1,
    fontSize: 11,
    fontWeight: "800",
    color: "#667085",
    textTransform: "uppercase",
  },
  tableHeadCell: {
    width: 102,
    fontSize: 11,
    fontWeight: "800",
    color: "#667085",
    textTransform: "uppercase",
  },
  groupCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E7E9EF",
    padding: 14,
    gap: 12,
    marginTop: 12,
  },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  groupTitleWrap: {
    flex: 1,
    minWidth: 220,
    gap: 6,
  },
  groupPill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  groupPillText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#185FA5",
  },
  groupSubText: {
    color: "#667085",
    fontSize: 12,
  },
  groupTargetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  groupMembers: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  memberChip: {
    borderWidth: 1,
    borderColor: "#D0D5DD",
    backgroundColor: "#F9FAFB",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  memberChipText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#344054",
  },
  memberAddBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  dashedButton: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#B7D4F2",
    backgroundColor: "#E6F1FB",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  dashedButtonText: {
    color: "#185FA5",
    fontWeight: "800",
    fontSize: 12,
  },
  logRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF1F5",
  },
  logIcon: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  logIconText: {
    fontSize: 15,
    fontWeight: "900",
  },
  logAssigned: {
    backgroundColor: "#E6F1FB",
  },
  logRemoved: {
    backgroundColor: "#FCEBEB",
  },
  logCompleted: {
    backgroundColor: "#EAF3DE",
  },
  logGroup: {
    backgroundColor: "#FAEEDA",
  },
  logSettings: {
    backgroundColor: "#F1EFE8",
  },
  logBody: {
    flex: 1,
    gap: 2,
  },
  logTitle: {
    color: "#101828",
    fontSize: 13,
    fontWeight: "800",
  },
  logDetail: {
    color: "#667085",
    fontSize: 12,
    lineHeight: 18,
  },
  logStamp: {
    color: "#98A2B3",
    fontSize: 11,
    fontWeight: "700",
  },
  toggleRow: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
  },
  togglePill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#F1EFE8",
    borderWidth: 1,
    borderColor: "#E4E7EC",
  },
  togglePillOn: {
    backgroundColor: "#E1F5EE",
    borderColor: "#B8E4D8",
  },
  togglePillText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#5F5E5A",
  },
  togglePillTextOn: {
    color: "#0F6E56",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  switchTextWrap: {
    flex: 1,
    gap: 2,
  },
  switchTitle: {
    color: "#101828",
    fontWeight: "800",
    fontSize: 13,
  },
  switchSub: {
    color: "#667085",
    fontSize: 12,
    lineHeight: 17,
  },
  stepperRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    paddingVertical: 10,
  },
  stepperLabel: {
    color: "#101828",
    fontWeight: "800",
    fontSize: 14,
  },
  stepperSub: {
    color: "#667085",
    fontSize: 12,
    marginTop: 3,
    lineHeight: 17,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#D0D5DD",
    borderRadius: 14,
    overflow: "hidden",
  },
  stepperBtn: {
    width: 40,
    height: 40,
    backgroundColor: "#F9FAFB",
    alignItems: "center",
    justifyContent: "center",
  },
  stepperBtnText: {
    fontSize: 22,
    lineHeight: 22,
    color: "#344054",
    fontWeight: "700",
  },
  stepperValueWrap: {
    minWidth: 54,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "#EAECF0",
  },
  stepperValue: {
    fontSize: 15,
    fontWeight: "800",
    color: "#101828",
  },
  portAmpGrid: {
    gap: 10,
  },
  ampRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  ampLabel: {
    width: 80,
    color: "#344054",
    fontSize: 13,
    fontWeight: "800",
  },
});

export default App;

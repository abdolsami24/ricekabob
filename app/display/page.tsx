"use client";

// Customer TV board. Reads ONLY the safe /api/board-orders feed
// (order numbers + statuses — never names, phones or prices).
// Polls every 5 seconds. When an order becomes READY it flashes
// full-screen for ~6 seconds and, if sound was enabled with the tap
// button, announces "Order number N is ready".

import { useEffect, useRef, useState } from "react";

interface BoardOrder {
  id: number;
  kitchen_status: string;
  payment_status: string;
  created_at: string;
}

const PREPARING = ["new", "accepted", "preparing"];

export default function DisplayPage() {
  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [testMode, setTestMode] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [flashId, setFlashId] = useState<number | null>(null);
  const knownReadyRef = useRef<Set<number>>(new Set());
  const firstLoadRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/board-orders", { cache: "no-store" });
        const data = (await res.json()) as { orders: BoardOrder[]; test_mode?: boolean };
        if (cancelled) return;
        const list = data.orders ?? [];
        setOrders(list);
        setTestMode(Boolean(data.test_mode));
        const readyNow = list.filter((o) => o.kitchen_status === "ready");
        if (!firstLoadRef.current) {
          const fresh = readyNow.find((o) => !knownReadyRef.current.has(o.id));
          if (fresh) {
            setFlashId(fresh.id);
            if (soundOn) {
              try {
                const utter = new SpeechSynthesisUtterance(`Order number ${fresh.id} is ready`);
                window.speechSynthesis.speak(utter);
              } catch {
                /* voice is optional */
              }
            }
            setTimeout(() => setFlashId(null), 6000);
          }
        }
        knownReadyRef.current = new Set(readyNow.map((o) => o.id));
        firstLoadRef.current = false;
      } catch {
        /* next poll retries */
      }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [soundOn]);

  const preparing = orders.filter((o) => PREPARING.includes(o.kitchen_status));
  const ready = orders.filter((o) => o.kitchen_status === "ready");

  return (
    <div className="display-body">
      {flashId !== null && (
        <div className="ready-flash">
          <div className="label">ORDER READY</div>
          <div className="big">#{flashId}</div>
          <div className="label">Please come to the counter</div>
        </div>
      )}
      <div className="display-wrap">
        <div className="display-head">
          <h1>Madinah Market — Order Status</h1>
          {!soundOn && (
            <button type="button" className="k-btn" onClick={() => setSoundOn(true)}>
              🔊 Enable sound
            </button>
          )}
        </div>
        <div className="display-cols">
          <section className="display-col preparing">
            <h2>🟡 PREPARING</h2>
            <div className="display-nums">
              {preparing.map((o) => (
                <div className="display-num" key={o.id}>
                  #{o.id}
                </div>
              ))}
              {preparing.length === 0 && <div style={{ color: "#737373", fontSize: "1.6rem" }}>—</div>}
            </div>
          </section>
          <section className="display-col ready">
            <h2>🟢 READY</h2>
            <div className="display-nums">
              {ready.map((o) => (
                <div className="display-num" key={o.id}>
                  #{o.id}
                </div>
              ))}
              {ready.length === 0 && <div style={{ color: "#737373", fontSize: "1.6rem" }}>—</div>}
            </div>
          </section>
        </div>
        <div className="display-foot">
          Madinah Market · 3126 S Parker Rd, Aurora · 720-763-0786
          {testMode && <div style={{ color: "#facc15" }}>TEST MODE — all orders shown</div>}
        </div>
      </div>
    </div>
  );
}

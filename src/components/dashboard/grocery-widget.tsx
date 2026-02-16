"use client";

import { useState, useEffect, useCallback } from "react";
import { ShoppingCart, Check, Plus } from "lucide-react";

interface GroceryItem {
  id: string;
  item: string;
  quantity: number;
  unit: string | null;
  category: string;
  completed: number;
}

export function GroceryWidget() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [newItem, setNewItem] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/grocery");
      const data = await res.json();
      setItems((data.items || []).filter((i: GroceryItem) => !i.completed));
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const addItem = async () => {
    const text = newItem.trim();
    if (!text) return;
    setNewItem("");
    await fetch("/api/grocery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", item: text }),
    });
    fetchItems();
  };

  const completeItem = async (item: GroceryItem) => {
    await fetch("/api/grocery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete", id: item.id }),
    });
    fetchItems();
  };

  return (
    <div className="bg-charcoal border border-steel-dark rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-vinegar-gold" />
          Grocery
        </h3>
        <span className="text-[10px] text-text-muted font-jetbrains">{items.length} items</span>
      </div>

      {/* Quick add */}
      <div className="flex gap-1">
        <input
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addItem()}
          placeholder="Quick add..."
          className="flex-1 bg-deep-space border border-steel-dark rounded px-2 py-1 text-[11px] text-text-primary placeholder-text-muted/40 focus:outline-none focus:border-vinegar-gold/40"
        />
        <button onClick={addItem} className="p-1 text-vinegar-gold hover:bg-vinegar-gold/10 rounded">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-text-muted text-center py-2">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-text-muted text-center py-2">List empty</p>
      ) : (
        <ul className="space-y-1 max-h-32 overflow-y-auto">
          {items.slice(0, 10).map(item => (
            <li key={item.id} className="flex items-center gap-2 text-xs group">
              <button onClick={() => completeItem(item)} className="w-3.5 h-3.5 rounded border border-steel-mid hover:border-success flex items-center justify-center shrink-0">
                <Check className="w-2 h-2 text-transparent group-hover:text-success" />
              </button>
              <span className="text-text-secondary truncate">
                {item.item}{item.quantity > 1 ? ` (${item.quantity})` : ""}
              </span>
            </li>
          ))}
          {items.length > 10 && <li className="text-[10px] text-text-muted">+{items.length - 10} more</li>}
        </ul>
      )}
    </div>
  );
}

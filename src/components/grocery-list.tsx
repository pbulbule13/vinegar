"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Check, Trash2, ShoppingCart, X } from "lucide-react";

interface GroceryItem {
  id: string;
  item: string;
  quantity: number;
  unit: string | null;
  category: string;
  completed: number;
}

const CATEGORY_ICONS: Record<string, string> = {
  produce: "🥬", dairy: "🥛", meat: "🥩", bakery: "🍞", frozen: "🧊",
  beverages: "🥤", snacks: "🍿", pantry: "🥫", household: "🧹", other: "📦",
};

export function GroceryList({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [newItem, setNewItem] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/grocery");
      const data = await res.json();
      setItems(data.items || []);
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

  const removeItem = async (item: GroceryItem) => {
    await fetch("/api/grocery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", id: item.id }),
    });
    fetchItems();
  };

  const activeItems = items.filter(i => !i.completed);
  const grouped = activeItems.reduce<Record<string, GroceryItem[]>>((acc, item) => {
    const cat = item.category || "other";
    (acc[cat] = acc[cat] || []).push(item);
    return acc;
  }, {});

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-vinegar-gold" />
            Grocery ({activeItems.length})
          </h3>
        </div>
        <ul className="space-y-1">
          {activeItems.slice(0, 5).map(item => (
            <li key={item.id} className="flex items-center gap-2 text-xs text-text-secondary">
              <button onClick={() => completeItem(item)} className="w-4 h-4 rounded border border-steel-mid hover:border-vinegar-gold flex items-center justify-center shrink-0">
                <Check className="w-2.5 h-2.5 text-transparent hover:text-vinegar-gold" />
              </button>
              <span>{item.item}{item.quantity > 1 ? ` (${item.quantity})` : ""}</span>
            </li>
          ))}
          {activeItems.length > 5 && <li className="text-[10px] text-text-muted">+{activeItems.length - 5} more</li>}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-orbitron text-text-primary flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-vinegar-gold" />
          Grocery List
        </h2>
        <span className="text-xs text-text-muted font-jetbrains">{activeItems.length} items</span>
      </div>

      {/* Add item */}
      <div className="flex gap-2">
        <input
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addItem()}
          placeholder="Add item..."
          className="flex-1 bg-charcoal border border-steel-dark rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted/40 focus:outline-none focus:border-vinegar-gold/40"
        />
        <button onClick={addItem} className="p-2 bg-vinegar-gold/20 border border-vinegar-gold/30 rounded-lg text-vinegar-gold hover:bg-vinegar-gold/30">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* List by category */}
      {loading ? (
        <p className="text-sm text-text-muted">Loading...</p>
      ) : activeItems.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-8">Your grocery list is empty. Add items or ask Vinegar!</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([category, catItems]) => (
            <div key={category}>
              <h3 className="text-xs font-jetbrains text-text-muted uppercase tracking-wider mb-2">
                {CATEGORY_ICONS[category] || "📦"} {category}
              </h3>
              <ul className="space-y-1">
                {catItems.map(item => (
                  <li key={item.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-gunmetal/50 group">
                    <button onClick={() => completeItem(item)} className="w-5 h-5 rounded border border-steel-mid hover:border-success flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 text-transparent group-hover:text-success" />
                    </button>
                    <span className="flex-1 text-sm text-text-primary">
                      {item.item}
                      {item.quantity > 1 && <span className="text-text-muted ml-1">x{item.quantity}{item.unit ? ` ${item.unit}` : ""}</span>}
                    </span>
                    <button onClick={() => removeItem(item)} className="opacity-0 group-hover:opacity-100 text-error/60 hover:text-error">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

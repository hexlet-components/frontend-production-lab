import React, { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import box from "./box.svg";
import "./style.css";

const Reports = lazy(() => import("./reports.jsx"));

const Movement = ({ apiBase, product, onChange }) => {
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");

  const move = async (type) => {
    setMessage("");
    const response = await fetch(`${apiBase}/movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: product.id, type, quantity: Number(quantity) }),
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error ?? `API ответил ${response.status}`);
      return;
    }
    onChange({ ...product, stock: result.stock });
    setMessage(type === "in" ? `Принято ${result.quantity} шт.` : `Выдано ${result.quantity} шт.`);
  };

  return (
    <div className="movement">
      <label>
        Количество{" "}
        <input
          type="number"
          min="1"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </label>
      <button type="button" onClick={() => move("in")}>
        Принять
      </button>
      <button type="button" onClick={() => move("out")}>
        Выдать
      </button>
      {message && <output>{message}</output>}
    </div>
  );
};

const BarcodeCheck = ({ product }) => {
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null);

  const check = (event) => {
    event.preventDefault();
    setResult(null);
    try {
      const scanned = code.replaceAll(" ", "");
      const expected = product.barcode.replaceAll(" ", "");
      setResult(
        scanned === expected
          ? { text: "Штрихкод совпадает" }
          : { text: "Это другой товар", failed: true },
      );
    } catch (error) {
      setResult({
        text: "Не удалось проверить штрихкод. Ошибка передана разработчикам.",
        failed: true,
      });
      reportError(error);
    }
  };

  return (
    <form className="scanner" onSubmit={check}>
      <label>
        Штрихкод с упаковки{" "}
        <input
          value={code}
          placeholder="4 600000 000071"
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <button type="submit">Проверить штрихкод</button>
      {result && <output className={result.failed ? "error" : undefined}>{result.text}</output>}
    </form>
  );
};

const App = ({ config }) => {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const changePath = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", changePath);
    fetch(`${config.apiBase}/products`)
      .then((response) => {
        if (!response.ok) throw new Error(`API ответил ${response.status}`);
        return response.json();
      })
      .then(setProducts)
      .catch((reason) => setError(reason.message));
    return () => window.removeEventListener("popstate", changePath);
  }, [config.apiBase]);

  const open = (nextPath) => {
    window.history.pushState({}, "", nextPath);
    setPathname(window.location.pathname);
  };
  const navigate = (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    open(event.currentTarget.pathname);
  };

  const prefix = import.meta.env.BASE_URL.replace(/\/$/, "");
  const path = pathname.slice(prefix.length) || "/";
  const selected = products.find((product) => `/products/${product.id}` === path);

  return (
    <main>
      <header>
        <h1>Остатки</h1>
        <span className="meta">
          Версия {__APP_VERSION__} · {config.environment}
        </span>
      </header>
      <nav>
        <a href={`${prefix}/`} onClick={navigate}>
          Товары
        </a>
        <a href={`${prefix}/products/42`} onClick={navigate}>
          Карточка товара
        </a>
        <a href={`${prefix}/reports`} onClick={navigate}>
          Отчёт
        </a>
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {path === "/reports" ? (
        <Suspense fallback={<p>Загружаем отчёт…</p>}>
          <Reports apiBase={config.apiBase} />
        </Suspense>
      ) : selected ? (
        <article className="card">
          <img src={box} alt={selected.name} />
          <div>
            <h2>{selected.name}</h2>
            <p>
              Цена {selected.price} ₽ · на складе {selected.stock} шт.
            </p>
            <Movement
              apiBase={config.apiBase}
              product={selected}
              onChange={(changed) =>
                setProducts((items) =>
                  items.map((item) => (item.id === changed.id ? changed : item)),
                )
              }
            />
            <BarcodeCheck key={selected.id} product={selected} />
          </div>
        </article>
      ) : path === "/" ? (
        <table>
          <thead>
            <tr>
              <th>Товар</th>
              <th>Цена</th>
              <th>На складе</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>
                  <a href={`${prefix}/products/${product.id}`} onClick={navigate}>
                    {product.name}
                  </a>
                </td>
                <td>{product.price} ₽</td>
                <td>{product.stock} шт.</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <h2>Товар не найден</h2>
      )}
    </main>
  );
};

const start = async () => {
  const response = await fetch(`${import.meta.env.BASE_URL}app-config.json`);
  if (!response.ok) throw new Error(`Конфигурация недоступна: ${response.status}`);
  const config = await response.json();
  if (typeof config.apiBase !== "string" || typeof config.environment !== "string") {
    throw new Error("В конфигурации нужны apiBase и environment");
  }
  createRoot(document.getElementById("root")).render(<App config={config} />);
};

start().catch((error) => {
  document.getElementById("root").textContent = error.message;
});

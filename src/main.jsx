import React, { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import book from "./book.svg";
import "./style.css";

const Reports = lazy(() => import("./reports.jsx"));

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

  const navigate = (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    window.history.pushState({}, "", event.currentTarget.pathname);
    setPathname(window.location.pathname);
  };

  const prefix = import.meta.env.BASE_URL.replace(/\/$/, "");
  const path = pathname.slice(prefix.length) || "/";
  const selected = products.find((product) => `/products/${product.id}` === path);

  return (
    <main>
      <header>
        <h1>Каталог товаров</h1>
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
          <Reports />
        </Suspense>
      ) : path === "/" || selected ? (
        <section>
          {(selected ? [selected] : products).map((product) => (
            <article className="card" key={product.id}>
              <img src={book} alt="Учебная книга" />
              <div>
                <h2>{product.name}</h2>
                <p>{product.price} ₽</p>
                <p>Готовое приложение для изучения выпуска и сопровождения.</p>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <h2>Товар не найден</h2>
      )}
      <button
        type="button"
        id="trigger-error"
        onClick={() => {
          throw new Error("catalog-demo-error");
        }}
      >
        Вызвать учебную ошибку
      </button>
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

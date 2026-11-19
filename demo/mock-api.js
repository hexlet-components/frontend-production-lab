// GitHub Pages раздаёт только статику. Этот модуль отвечает на запросы
// конфига и API приложения в браузере и хранит остатки в localStorage.
import initialProducts from "../data/products.json";

const key = "warehouse-stock-demo";
const fresh = () => ({
  products: initialProducts.map((product) => ({ ...product })),
  movements: [],
});
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fresh();
  } catch {
    return fresh();
  }
};
const save = (state) => {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Без хранилища демо работает до перезагрузки страницы.
  }
};
const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const move = (state, input) => {
  const product = state.products.find((item) => item.id === input?.productId);
  const quantity = input?.quantity;
  if (!product || !["in", "out"].includes(input?.type))
    return reply({ error: "Нужны productId и type: in или out" }, 400);
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    return reply({ error: "Количество должно быть целым и больше нуля" }, 400);
  if (input.type === "out" && quantity > product.stock)
    return reply({ error: `На складе только ${product.stock}` }, 409);
  product.stock += input.type === "in" ? quantity : -quantity;
  const movement = {
    id: state.movements.length + 1,
    productId: product.id,
    type: input.type,
    quantity,
    stock: product.stock,
    at: new Date().toISOString(),
  };
  state.movements.push(movement);
  save(state);
  return reply(movement, 201);
};

const network = window.fetch.bind(window);
window.fetch = async (resource, options = {}) => {
  const url = new URL(resource instanceof Request ? resource.url : resource, window.location.href);
  const method = (options.method ?? "GET").toUpperCase();
  if (url.pathname.endsWith("/app-config.json"))
    return reply({ environment: "demo", apiBase: "/api" });
  const match = url.pathname.match(/\/api\/(products|movements)(?:\/(\d+))?$/);
  if (!match) return network(resource, options);
  const state = load();
  const [, collection, id] = match;
  if (collection === "movements" && method === "POST") {
    let input;
    try {
      input = JSON.parse(options.body);
    } catch {
      return reply({ error: "Ожидается JSON" }, 400);
    }
    return move(state, input);
  }
  if (collection === "movements") return reply(state.movements);
  if (!id) return reply(state.products);
  const product = state.products.find((item) => item.id === Number(id));
  return product ? reply(product) : reply({ error: "Not found" }, 404);
};

import React, { useEffect, useState } from "react";

const Reports = ({ apiBase }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all(
      ["products", "movements"].map((name) =>
        fetch(`${apiBase}/${name}`).then((response) => {
          if (!response.ok) throw new Error(`API ответил ${response.status}`);
          return response.json();
        }),
      ),
    )
      .then(([products, movements]) => setData({ products, movements }))
      .catch((reason) => setError(reason.message));
  }, [apiBase]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Загружаем отчёт…</p>;

  const names = new Map(data.products.map((product) => [product.id, product.name]));
  const total = (type) =>
    data.movements
      .filter((movement) => movement.type === type)
      .reduce((sum, movement) => sum + movement.quantity, 0);

  return (
    <section>
      <h2>Движение товаров</h2>
      <p>
        Принято {total("in")} шт., выдано {total("out")} шт. Отчёт загружен отдельным чанком, версия
        приложения {__APP_VERSION__}.
      </p>
      {data.movements.length === 0 ? (
        <p>Движений пока нет.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Товар</th>
              <th>Операция</th>
              <th>Количество</th>
              <th>Остаток</th>
            </tr>
          </thead>
          <tbody>
            {data.movements.map((movement) => (
              <tr key={movement.id}>
                <td>{new Date(movement.at).toLocaleTimeString("ru-RU")}</td>
                <td>{names.get(movement.productId)}</td>
                <td>{movement.type === "in" ? "Приём" : "Выдача"}</td>
                <td>{movement.quantity}</td>
                <td>{movement.stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};

export default Reports;

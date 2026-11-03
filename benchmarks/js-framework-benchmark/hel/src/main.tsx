import { For, mount } from "hel/runtime";

const adjectives = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important", "inexpensive", "cheap", "expensive", "fancy"];
const colors = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"];
const nouns = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse", "keyboard"];

type Row = {
  id: number;
  label: string;
};

const random = (max: number) => Math.round(Math.random() * 1000) % max;

let nextId = 1;

function buildData(count: number): Row[] {
  const data = new Array<Row>(count);

  for (let i = 0; i < count; i += 1) {
    data[i] = {
      id: nextId,
      label: `${adjectives[random(adjectives.length)]} ${colors[random(colors.length)]} ${nouns[random(nouns.length)]}`,
    };
    nextId += 1;
  }

  return data;
}

function Button(props: { id: string; text: string; onClick: () => void }) {
  return (
    <div class="col-sm-6 smallpad">
      <button id={props.id} class="btn btn-primary btn-block" type="button" onClick={props.onClick}>{props.text}</button>
    </div>
  );
}

function App() {
  let rows: Row[] = [];
  let selected = 0;

  function swapRows() {
    if (rows.length > 998) {
      const next = rows.slice();
      next[1] = rows[998]!;
      next[998] = rows[1]!;
      rows = next;
    }
  }

  return (
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6">
            <h1>Hel</h1>
          </div>
          <div class="col-md-6">
            <div class="row">
              <Button id="run" text="Create 1,000 rows" onClick={() => { rows = buildData(1000); }} />
              <Button id="runlots" text="Create 10,000 rows" onClick={() => { rows = buildData(10000); }} />
              <Button id="add" text="Append 1,000 rows" onClick={() => { rows = [...rows, ...buildData(1000)]; }} />
              <Button id="update" text="Update every 10th row" onClick={() => { rows = rows.map((row, index) => (index % 10 === 0 ? { ...row, label: `${row.label} !!!` } : row)); }} />
              <Button id="clear" text="Clear" onClick={() => { rows = []; }} />
              <Button id="swaprows" text="Swap Rows" onClick={swapRows} />
            </div>
          </div>
        </div>
      </div>
      <table class="table table-hover table-striped test-data">
        <tbody>
          <For each={rows} key={(row: Row) => row.id}>
            {(row: Row) => (
              <tr class={selected === row.id ? "danger" : ""}>
                <td class="col-md-1">{row.id}</td>
                <td class="col-md-4"><a onClick={() => { selected = row.id; }}>{row.label}</a></td>
                <td class="col-md-1">
                  <a onClick={() => { rows = rows.filter((entry) => entry.id !== row.id); }}>
                    <span class="glyphicon glyphicon-remove" aria-hidden="true" />
                  </a>
                </td>
                <td class="col-md-6" />
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <span class="preloadicon glyphicon glyphicon-remove" aria-hidden="true" />
    </div>
  );
}

mount(() => <App />, document.getElementById("main")!);

export type Species = "dog" | "cat" | "bird" | "fish" | "reptile";

export type Pet = {
  id: number;
  name: string;
  species: Species;
  breed: string;
  age: number;
  price: number;
  stock: number;
  emoji: string;
  description: string;
};

export type Catalog = {
  items: Pet[];
  total: number;
  page: number;
  pages: number;
};

export type Review = {
  id: number;
  petId: number;
  author: string;
  rating: number;
  text: string;
  createdAt: string;
};

export type OrderLine = {
  petId: number;
  name: string;
  price: number;
  quantity: number;
};

export type Customer = {
  name: string;
  email: string;
  address: string;
};

export type Order = {
  id: string;
  lines: OrderLine[];
  total: number;
  customer: Customer;
  status: "paid" | "cancelled";
  createdAt: string;
};

export type User = {
  name: string;
  role: "admin" | "customer";
};

export type Session = {
  token: string;
  user: User;
};

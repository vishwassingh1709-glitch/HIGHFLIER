import { Counter } from '../models/Counter.js';

export const generateOrderNumber = async () => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const counter = await Counter.findByIdAndUpdate(
    `order-${datePart}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return `HF-${datePart}-${String(counter.seq).padStart(6, '0')}`;
};

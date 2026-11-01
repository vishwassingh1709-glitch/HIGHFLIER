import { roundMoney } from '../../utils/money.js';
import { Product } from '../../models/Product.js';

const DEFAULT_RULE = Object.freeze({ type: 'percent', value: 35, minMarginPercent: 0 });

export const normalizeMarkupRule = (rule) => {
  const source = rule?.toObject ? rule.toObject() : rule || {};
  return {
    type: source.type === 'fixed' ? 'fixed' : DEFAULT_RULE.type,
    value: Number.isFinite(Number(source.value)) ? Math.max(0, Number(source.value)) : DEFAULT_RULE.value,
    minMarginPercent: Number.isFinite(Number(source.minMarginPercent))
      ? Math.min(100, Math.max(0, Number(source.minMarginPercent)))
      : DEFAULT_RULE.minMarginPercent
  };
};

/**
 * Selling price = supplier cost + configured markup, respecting an optional
 * minimum margin. Rounded up to the next whole rupee for a clean INR price.
 */
export const calculateSellingPrice = (supplierCost, markupRule) => {
  const cost = roundMoney(Math.max(0, Number(supplierCost) || 0));
  const rule = normalizeMarkupRule(markupRule);

  let price = rule.type === 'fixed' ? cost + rule.value : cost * (1 + rule.value / 100);

  if (rule.minMarginPercent > 0) {
    const minPrice = cost / (1 - rule.minMarginPercent / 100);
    price = Math.max(price, minPrice);
  }

  price = Math.max(price, cost);
  return Math.max(0, Math.ceil(roundMoney(price)));
};

export const summarizeVariants = (variants = []) => {
  if (!variants.length) {
    return { supplierCost: 0, sellingPrice: 0, mrp: 0, stock: 0 };
  }

  const supplierCost = Math.min(...variants.map((variant) => Number(variant.supplierCost) || 0));
  const sellingPrice = Math.min(...variants.map((variant) => Number(variant.sellingPrice) || 0));
  const mrp = Math.max(...variants.map((variant) => Number(variant.mrp) || 0));
  const stock = variants.reduce((sum, variant) => sum + (Number(variant.stock) || 0), 0);

  return { supplierCost, sellingPrice, mrp: Math.max(mrp, sellingPrice), stock };
};

export const applyMarkupToVariants = (variants, markupRule) => {
  for (const variant of variants) {
    if (!variant.isPriceLocked) {
      variant.sellingPrice = calculateSellingPrice(variant.supplierCost, markupRule);
    }
    if (!Number.isFinite(Number(variant.mrp)) || Number(variant.mrp) < variant.sellingPrice) {
      variant.mrp = variant.sellingPrice;
    }
  }
  return summarizeVariants(variants);
};

export const repriceSupplierProducts = async (supplier) => {
  const products = await Product.find({ supplier: supplier._id });
  let updated = 0;

  for (const product of products) {
    const previous = product.sellingPrice;
    const summary = applyMarkupToVariants(product.variants, supplier.markupRule);
    product.supplierCost = summary.supplierCost;
    product.sellingPrice = summary.sellingPrice;
    product.mrp = summary.mrp;
    product.stock = summary.stock;
    await product.save();
    if (previous !== product.sellingPrice) updated += 1;
  }

  return { processed: products.length, priceChanged: updated };
};

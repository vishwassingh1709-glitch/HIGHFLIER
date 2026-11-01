/**
 * Deterministic demo catalogue for the MOCK supplier adapter only.
 * These are fictional products, fictional brands and placeholder images.
 * They do not represent any real supplier, real stock or real fulfilment.
 */

const image = (label, color = '0f172a') =>
  `https://placehold.co/800x800/${color}/ffffff?text=${encodeURIComponent(label)}`;

export const MOCK_CATALOGUE = [
  {
    supplierProductId: 'MOCK-1001',
    supplierSku: 'NT-EARBUD-PRO',
    title: 'NovaTech Wireless Earbuds Pro',
    description:
      'Fictional demo product. Bluetooth 5.3 earbuds with active noise cancellation, 30-hour battery case and USB-C charging.',
    category: 'Electronics',
    brand: 'NovaTech',
    attributes: { connectivity: 'Bluetooth 5.3', warranty: '1 year demo warranty' },
    images: [image('NovaTech Earbuds', '1d4ed8')],
    currency: 'INR',
    variants: [
      {
        supplierVariantId: 'MOCK-1001-BLK',
        sku: 'NT-EARBUD-PRO-BLK',
        name: 'Midnight Black',
        attributes: { color: 'Black' },
        supplierCost: 1450,
        mrp: 3499,
        stock: 40
      },
      {
        supplierVariantId: 'MOCK-1001-WHT',
        sku: 'NT-EARBUD-PRO-WHT',
        name: 'Pearl White',
        attributes: { color: 'White' },
        supplierCost: 1450,
        mrp: 3499,
        stock: 25
      }
    ]
  },
  {
    supplierProductId: 'MOCK-1002',
    supplierSku: 'NT-BAND-2',
    title: 'NovaTech Smart Fitness Band 2',
    description:
      'Fictional demo product. Fitness band with heart-rate tracking, SpO2 monitor, sleep tracking and 14-day battery life.',
    category: 'Electronics',
    brand: 'NovaTech',
    attributes: { display: '1.47 inch AMOLED', waterResistance: '5 ATM' },
    images: [image('Fitness Band', '0f766e')],
    currency: 'INR',
    variants: [
      {
        supplierVariantId: 'MOCK-1002-MID',
        sku: 'NT-BAND-2-MID',
        name: 'Midnight',
        attributes: { color: 'Midnight' },
        supplierCost: 899,
        mrp: 2499,
        stock: 30
      },
      {
        supplierVariantId: 'MOCK-1002-TEA',
        sku: 'NT-BAND-2-TEA',
        name: 'Teal',
        attributes: { color: 'Teal' },
        supplierCost: 899,
        mrp: 2499,
        stock: 20
      }
    ]
  },
  {
    supplierProductId: 'MOCK-1003',
    supplierSku: 'UT-OVERSIZED-TEE',
    title: 'UrbanThread Cotton Oversized T-Shirt',
    description: 'Fictional demo product. 240 GSM combed cotton oversized fit t-shirt with drop shoulders.',
    category: 'Fashion',
    brand: 'UrbanThread',
    attributes: { fabric: '100% cotton', fit: 'Oversized' },
    images: [image('Oversized Tee', '7c3aed')],
    currency: 'INR',
    variants: [
      { supplierVariantId: 'MOCK-1003-S', sku: 'UT-TEE-S', name: 'S', attributes: { size: 'S' }, supplierCost: 320, mrp: 999, stock: 15 },
      { supplierVariantId: 'MOCK-1003-M', sku: 'UT-TEE-M', name: 'M', attributes: { size: 'M' }, supplierCost: 320, mrp: 999, stock: 20 },
      { supplierVariantId: 'MOCK-1003-L', sku: 'UT-TEE-L', name: 'L', attributes: { size: 'L' }, supplierCost: 320, mrp: 999, stock: 18 },
      { supplierVariantId: 'MOCK-1003-XL', sku: 'UT-TEE-XL', name: 'XL', attributes: { size: 'XL' }, supplierCost: 340, mrp: 1099, stock: 8 }
    ]
  },
  {
    supplierProductId: 'MOCK-1004',
    supplierSku: 'UT-DENIM-JACKET',
    title: 'UrbanThread Everyday Denim Jacket',
    description: 'Fictional demo product. Mid-wash denim jacket with button front and chest pockets.',
    category: 'Fashion',
    brand: 'UrbanThread',
    attributes: { fabric: 'Cotton denim', fit: 'Regular' },
    images: [image('Denim Jacket', '1e3a8a')],
    currency: 'INR',
    variants: [
      { supplierVariantId: 'MOCK-1004-M', sku: 'UT-JKT-M', name: 'M', attributes: { size: 'M' }, supplierCost: 1150, mrp: 2999, stock: 10 },
      { supplierVariantId: 'MOCK-1004-L', sku: 'UT-JKT-L', name: 'L', attributes: { size: 'L' }, supplierCost: 1150, mrp: 2999, stock: 12 },
      { supplierVariantId: 'MOCK-1004-XL', sku: 'UT-JKT-XL', name: 'XL', attributes: { size: 'XL' }, supplierCost: 1180, mrp: 3099, stock: 6 }
    ]
  },
  {
    supplierProductId: 'MOCK-1005',
    supplierSku: 'HN-DINNER-SET',
    title: 'HomeNest Ceramic Dinner Set (18 Pieces)',
    description: 'Fictional demo product. 18-piece glazed ceramic dinner set for six, microwave and dishwasher safe.',
    category: 'Home & Living',
    brand: 'HomeNest',
    attributes: { pieces: '18', material: 'Ceramic' },
    images: [image('Dinner Set', 'b45309')],
    currency: 'INR',
    variants: [
      {
        supplierVariantId: 'MOCK-1005-WHT',
        sku: 'HN-DINNER-WHT',
        name: 'Gloss White',
        attributes: { color: 'Gloss White' },
        supplierCost: 1650,
        mrp: 3999,
        stock: 14
      }
    ]
  },
  {
    supplierProductId: 'MOCK-1006',
    supplierSku: 'HN-BEDSHEET',
    title: 'HomeNest 300 TC Cotton Bedsheet Set',
    description: 'Fictional demo product. 300 thread count cotton bedsheet with two pillow covers.',
    category: 'Home & Living',
    brand: 'HomeNest',
    attributes: { threadCount: '300', includes: '1 bedsheet + 2 pillow covers' },
    images: [image('Bedsheet Set', 'be123c')],
    currency: 'INR',
    variants: [
      { supplierVariantId: 'MOCK-1006-Q', sku: 'HN-SHEET-Q', name: 'Queen', attributes: { size: 'Queen' }, supplierCost: 620, mrp: 1799, stock: 22 },
      { supplierVariantId: 'MOCK-1006-K', sku: 'HN-SHEET-K', name: 'King', attributes: { size: 'King' }, supplierCost: 720, mrp: 1999, stock: 16 }
    ]
  },
  {
    supplierProductId: 'MOCK-1007',
    supplierSku: 'GL-VITC-SERUM',
    title: 'GlowLeaf Vitamin C Face Serum 30ml',
    description: 'Fictional demo product. 10% vitamin C serum with niacinamide for dull skin. External-use demo product.',
    category: 'Beauty',
    brand: 'GlowLeaf',
    attributes: { volume: '30ml', skinType: 'All' },
    images: [image('Vitamin C Serum', 'a16207')],
    currency: 'INR',
    variants: [
      {
        supplierVariantId: 'MOCK-1007-30',
        sku: 'GL-SERUM-30',
        name: '30ml',
        attributes: { volume: '30ml' },
        supplierCost: 240,
        mrp: 799,
        stock: 50
      }
    ]
  },
  {
    supplierProductId: 'MOCK-1008',
    supplierSku: 'AP-YOGA-MAT',
    title: 'ActivePeak Anti-Slip Yoga Mat 6mm',
    description: 'Fictional demo product. 6mm TPE yoga mat with carrying strap.',
    category: 'Sports',
    brand: 'ActivePeak',
    attributes: { thickness: '6mm', material: 'TPE' },
    images: [image('Yoga Mat', '15803d')],
    currency: 'INR',
    variants: [
      { supplierVariantId: 'MOCK-1008-GRN', sku: 'AP-MAT-GRN', name: 'Forest Green', attributes: { color: 'Green' }, supplierCost: 450, mrp: 1299, stock: 25 },
      { supplierVariantId: 'MOCK-1008-GRY', sku: 'AP-MAT-GRY', name: 'Slate Grey', attributes: { color: 'Grey' }, supplierCost: 450, mrp: 1299, stock: 0 }
    ]
  },
  {
    supplierProductId: 'MOCK-1009',
    supplierSku: 'TM-BOTTLE-1L',
    title: 'TrailMate Stainless Steel Bottle 1L',
    description: 'Fictional demo product. Double-wall vacuum insulated bottle, keeps drinks cold for 24 hours.',
    category: 'Accessories',
    brand: 'TrailMate',
    attributes: { capacity: '1 litre', material: 'Stainless steel' },
    images: [image('Steel Bottle', '374151')],
    currency: 'INR',
    variants: [
      { supplierVariantId: 'MOCK-1009-SLV', sku: 'TM-BTL-SLV', name: 'Silver', attributes: { color: 'Silver' }, supplierCost: 280, mrp: 899, stock: 45 },
      { supplierVariantId: 'MOCK-1009-BLK', sku: 'TM-BTL-BLK', name: 'Black', attributes: { color: 'Black' }, supplierCost: 280, mrp: 899, stock: 35 }
    ]
  },
  {
    supplierProductId: 'MOCK-1010',
    supplierSku: 'DC-ALMOND-500',
    title: 'DailyCart Organic Almonds 500g',
    description: 'Fictional demo product. Raw organic almonds, 500g resealable pack.',
    category: 'Grocery',
    brand: 'DailyCart',
    attributes: { weight: '500g', type: 'Raw almonds' },
    images: [image('Almonds 500g', '92400e')],
    currency: 'INR',
    variants: [
      {
        supplierVariantId: 'MOCK-1010-500',
        sku: 'DC-ALMOND-500',
        name: '500g',
        attributes: { weight: '500g' },
        supplierCost: 390,
        mrp: 699,
        stock: 60
      }
    ]
  },
  {
    supplierProductId: 'MOCK-1011',
    supplierSku: 'NT-CHARGER-65',
    title: 'NovaTech 65W USB-C Fast Charger',
    description: 'Fictional demo product. 65W GaN charger with one USB-C and one USB-A port.',
    category: 'Electronics',
    brand: 'NovaTech',
    attributes: { output: '65W', ports: '1x USB-C, 1x USB-A' },
    images: [image('65W Charger', '334155')],
    currency: 'INR',
    variants: [
      {
        supplierVariantId: 'MOCK-1011-65',
        sku: 'NT-CHG-65',
        name: '65W',
        attributes: { output: '65W' },
        supplierCost: 780,
        mrp: 1999,
        stock: 28
      }
    ]
  },
  {
    supplierProductId: 'MOCK-1012',
    supplierSku: 'UT-CANVAS-SNKR',
    title: 'UrbanThread Classic Canvas Sneakers',
    description: 'Fictional demo product. Low-top canvas sneakers with cushioned insole.',
    category: 'Fashion',
    brand: 'UrbanThread',
    attributes: { upper: 'Canvas', sole: 'Rubber' },
    images: [image('Canvas Sneakers', '0e7490')],
    currency: 'INR',
    variants: [
      { supplierVariantId: 'MOCK-1012-7', sku: 'UT-SNK-7', name: 'UK 7', attributes: { size: '7' }, supplierCost: 890, mrp: 2499, stock: 9 },
      { supplierVariantId: 'MOCK-1012-8', sku: 'UT-SNK-8', name: 'UK 8', attributes: { size: '8' }, supplierCost: 890, mrp: 2499, stock: 11 },
      { supplierVariantId: 'MOCK-1012-9', sku: 'UT-SNK-9', name: 'UK 9', attributes: { size: '9' }, supplierCost: 890, mrp: 2499, stock: 10 },
      { supplierVariantId: 'MOCK-1012-10', sku: 'UT-SNK-10', name: 'UK 10', attributes: { size: '10' }, supplierCost: 890, mrp: 2499, stock: 5 }
    ]
  }
];

export const syncLogTypeForStatus = (status) =>
  ['shipped', 'delivered'].includes(status) ? 'tracking' : 'order_status';

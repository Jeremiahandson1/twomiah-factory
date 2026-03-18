import React from 'react'
import { View, Text, StyleSheet } from 'react-native'

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  // Jobs
  scheduled: { bg: '#dbeafe', text: '#1d4ed8' },
  dispatched: { bg: '#fef3c7', text: '#92400e' },
  in_progress: { bg: '#dcfce7', text: '#166534' },
  completed: { bg: '#f1f5f9', text: '#475569' },
  // Quotes
  draft: { bg: '#f1f5f9', text: '#475569' },
  sent: { bg: '#dbeafe', text: '#1d4ed8' },
  approved: { bg: '#dcfce7', text: '#166534' },
  rejected: { bg: '#fee2e2', text: '#991b1b' },
  // Contacts
  lead: { bg: '#fef3c7', text: '#92400e' },
  client: { bg: '#dcfce7', text: '#166534' },
  subcontractor: { bg: '#e0e7ff', text: '#3730a3' },
  vendor: { bg: '#fce7f3', text: '#9d174d' },
  // Priority
  low: { bg: '#f1f5f9', text: '#64748b' },
  normal: { bg: '#dbeafe', text: '#1d4ed8' },
  high: { bg: '#fef3c7', text: '#92400e' },
  urgent: { bg: '#fee2e2', text: '#991b1b' },
  // Generic
  open: { bg: '#dbeafe', text: '#1d4ed8' },
  closed: { bg: '#f1f5f9', text: '#475569' },
  new: { bg: '#dcfce7', text: '#166534' },
  // Dispensary orders
  pending: { bg: '#fef3c7', text: '#92400e' },
  confirmed: { bg: '#dbeafe', text: '#1d4ed8' },
  preparing: { bg: '#e0e7ff', text: '#3730a3' },
  ready: { bg: '#dcfce7', text: '#166534' },
  out_for_delivery: { bg: '#fce7f3', text: '#9d174d' },
  cancelled: { bg: '#fee2e2', text: '#991b1b' },
  refunded: { bg: '#fee2e2', text: '#991b1b' },
  // Dispensary loyalty tiers
  bronze: { bg: '#fef3c7', text: '#92400e' },
  silver: { bg: '#f1f5f9', text: '#475569' },
  gold: { bg: '#fef3c7', text: '#b45309' },
  platinum: { bg: '#e0e7ff', text: '#3730a3' },
  // Homecare
  clocked_in: { bg: '#dcfce7', text: '#166534' },
  clocked_out: { bg: '#f1f5f9', text: '#475569' },
  missed: { bg: '#fee2e2', text: '#991b1b' },
  // Roofing pipeline
  new_lead: { bg: '#dbeafe', text: '#1d4ed8' },
  contacted: { bg: '#fef3c7', text: '#92400e' },
  inspection_scheduled: { bg: '#e0e7ff', text: '#3730a3' },
  quote_sent: { bg: '#fce7f3', text: '#9d174d' },
  won: { bg: '#dcfce7', text: '#166534' },
  lost: { bg: '#fee2e2', text: '#991b1b' },
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const colors = STATUS_COLORS[status] || { bg: '#f1f5f9', text: '#475569' }
  const display = label || status.replace(/_/g, ' ')

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.text, { color: colors.text }]}>{display}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
})

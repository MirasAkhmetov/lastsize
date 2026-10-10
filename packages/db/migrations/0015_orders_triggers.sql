CREATE TRIGGER cart_items_set_updated_at BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER seller_orders_set_updated_at BEFORE UPDATE ON seller_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- What was bought never changes after checkout, whatever the code path.
CREATE TRIGGER order_items_immutable
  BEFORE UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION reject_modification();
--> statement-breakpoint
CREATE TRIGGER seller_order_status_history_append_only
  BEFORE UPDATE OR DELETE ON seller_order_status_history
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TRIGGER return_items_append_only
  BEFORE UPDATE OR DELETE ON return_items
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

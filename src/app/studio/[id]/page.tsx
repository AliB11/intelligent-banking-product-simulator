import { notFound } from "next/navigation";
import { productId as parseId } from "@/lib/api";
import Studio from "@/components/Studio";
import { getProduct } from "@/db/repo";

export const dynamic = "force-dynamic";

export default async function EditStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let parsed: number;
  try { parsed = parseId(id); } catch { notFound(); }
  const product = await getProduct(parsed);
  if (!product) notFound();
  return <Studio key={`${product.id}-${product.configVersion}`} initial={product.config} productId={product.id} configVersion={product.configVersion} />;
}

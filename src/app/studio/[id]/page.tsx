import { notFound } from "next/navigation";
import Studio from "@/components/Studio";
import { getProduct } from "@/db/repo";

export const dynamic = "force-dynamic";

export default async function EditStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(Number(id));
  if (!product) notFound();
  return <Studio key={product.id} initial={product.config} productId={product.id} />;
}

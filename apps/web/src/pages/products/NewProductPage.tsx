import type { CreateProductRequest } from '@kirana/shared';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../api/client';
import { ProductForm } from './ProductForm';

export function NewProductPage() {
  const { t } = useTranslation();
  const { storeId = '' } = useParams();
  const navigate = useNavigate();
  return (
    <section className="card">
      <p>
        <Link to={`/stores/${storeId}/products`}>{t('products.title')}</Link>
      </p>
      <h1>{t('product.newTitle')}</h1>
      <ProductForm
        submitLabel={t('product.create')}
        onSubmit={async (body) => {
          const { product } = await api.createProduct(storeId, body as CreateProductRequest);
          navigate(`/stores/${storeId}/products/${product.id}`);
        }}
      />
    </section>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Plus,
  Package,
  Edit,
  Power,
  X,
  AlertCircle,
  FolderTree,
  FolderPlus,
  Tag,
  Store,
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Layers,
  History,
  ArrowLeft,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ProductService } from '../../services/productService';
import { CategoryService } from '../../services/categoryService';
import { Product, Category, ProductImage } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { ProductThumbnail } from '../common/ProductThumbnail';
import { ProductImageViewerModal } from '../common/ProductImageViewerModal';
import { ProductImageUpload } from '../common/ProductImageUpload';
import {
  getAdminManagedShops,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../../utils/permissions';

const PAGE_SIZE = 5;

export const AdminProducts: React.FC = () => {
  const {
    currentUser,
    dbState,
    addToast,
    selectedShopId,
    productsSubTab,
    setProductsSubTab,
    productsNavTick,
  } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [shopFilter, setShopFilter] = useState('ALL');
  const [categoryShopFilter, setCategoryShopFilter] = useState('ALL');

  // Collapse state per shop
  const [collapsedShops, setCollapsedShops] = useState<Set<string>>(new Set());

  // Pagination state per shop
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({});
  const [loadingShops, setLoadingShops] = useState<Set<string>>(new Set());

  // Product edit / delete state
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);

  // Product Form Fields
  const [productShopId, setProductShopId] = useState('');
  const [name, setName] = useState('');
  const [variation, setVariation] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [currentStock, setCurrentStock] = useState('0');
  const [minStock, setMinStock] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [destinationType, setDestinationType] = useState<'SHOP_FLOOR' | 'STORE'>('SHOP_FLOOR');
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Image Viewer
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);

  // Category Modal (inline quick create from Add Product form)
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [catShopIdInput, setCatShopIdInput] = useState('');
  const [catNameInput, setCatNameInput] = useState('');
  const [catColorInput, setCatColorInput] = useState('#3b82f6');
  const [catModalError, setCatModalError] = useState('');

  if (!currentUser) return null;
  if (
    !hasAdminAccess(currentUser) &&
    !currentUser.permissions?.canEditProducts &&
    !currentUser.permissions?.canDeleteProducts
  ) {
    return null;
  }

  const platformAdmin = isPlatformAdmin(currentUser);
  const shopAdmin = isShopAdmin(currentUser);
  const settings = dbState.settings;
  const allShops = dbState.shops || [];
  const shops = platformAdmin
    ? allShops
    : shopAdmin
      ? getAdminManagedShops(currentUser, allShops)
      : allShops.filter(s => (currentUser.assignedShopIds || []).includes(s.id));
  const visibleShopIdSet = new Set(shops.map(s => s.id));

  const categories = (dbState.categories || []).filter(
    c => platformAdmin || visibleShopIdSet.has(c.shopId)
  );

  const availableFilterCategories =
    shopFilter === 'ALL' ? categories : categories.filter(c => c.shopId === shopFilter);

  const allProducts = (dbState.products || []).filter(
    p => platformAdmin || (!!p.shopId && visibleShopIdSet.has(p.shopId))
  );

  const products = allProducts.filter(p => {
    if (shopFilter !== 'ALL' && p.shopId !== shopFilter) return false;
    if (categoryFilter !== 'ALL' && p.categoryId !== categoryFilter) return false;
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.variation || '').toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group products by shop
  const groupedByShop = shops
    .map(shop => ({
      shop,
      products: products.filter(p => p.shopId === shop.id),
    }))
    .filter(group => group.products.length > 0);

  const productsWithNoShop = products.filter(p => !shops.some(s => s.id === p.shopId));

  const toggleShopCollapse = (shopId: string) => {
    setCollapsedShops(prev => {
      const next = new Set(prev);
      if (next.has(shopId)) next.delete(shopId);
      else next.add(shopId);
      return next;
    });
  };

  // ==============================
  // PAGINATION HELPERS
  // ==============================
  const getVisibleCount = (shopId: string): number => {
    return visibleCounts[shopId] ?? PAGE_SIZE;
  };

  const handleSeeMore = (shopId: string) => {
    setLoadingShops(prev => new Set(prev).add(shopId));
    setTimeout(() => {
      setVisibleCounts(prev => ({
        ...prev,
        [shopId]: (prev[shopId] ?? PAGE_SIZE) + PAGE_SIZE,
      }));
      setLoadingShops(prev => {
        const next = new Set(prev);
        next.delete(shopId);
        return next;
      });
    }, 300);
  };

  const handleSeeLess = (shopId: string) => {
    setVisibleCounts(prev => ({
      ...prev,
      [shopId]: PAGE_SIZE,
    }));
  };

  const initAddProductForm = () => {
    setEditingProduct(null);
    const initialShopId =
      selectedShopId && selectedShopId !== 'ALL' && visibleShopIdSet.has(selectedShopId)
        ? selectedShopId
        : shops[0]?.id || '';
    setProductShopId(initialShopId);
    setName('');
    setVariation('');
    setSku('');
    setBarcode('');
    const shopCats = categories.filter(c => c.shopId === initialShopId && c.status !== 'INACTIVE');
    setCategoryId(
      shopCats[0]?.id ||
        categories.find(c => c.status !== 'INACTIVE')?.id ||
        categories[0]?.id ||
        ''
    );
    setPurchasePrice('');
    setSellingPrice('');
    setCurrentStock('0');
    setMinStock('');
    setUnit('pcs');
    setProductImages([]);
    setDestinationType('SHOP_FLOOR');
    const shopStores = (dbState.stores || []).filter(
      st => st.shopId === initialShopId && st.status === 'ACTIVE' && !st.isShopFloor
    );
    setSelectedStoreId(shopStores[0]?.id || '');
    setFormError('');
  };

  const initAddCategoryForm = (targetShopId?: string) => {
    setEditingCategory(null);
    const defaultShop =
      targetShopId && visibleShopIdSet.has(targetShopId)
        ? targetShopId
        : selectedShopId && selectedShopId !== 'ALL' && visibleShopIdSet.has(selectedShopId)
          ? selectedShopId
          : shops[0]?.id || '';
    setCatShopIdInput(defaultShop);
    setCatNameInput('');
    setCatColorInput('#3b82f6');
    setCatModalError('');
  };

  // Initialize fresh forms when mounting directly into add_product / add_category
  useEffect(() => {
    if (productsSubTab === 'add_product' && !editingProduct) {
      initAddProductForm();
    } else if (productsSubTab === 'add_category' && !editingCategory) {
      initAddCategoryForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productsSubTab, productsNavTick]);

  // Reset editing state when navigating via sidebar/drawer menu
  const prevProductsNavTickRef = useRef(productsNavTick);
  useEffect(() => {
    if (prevProductsNavTickRef.current !== productsNavTick) {
      prevProductsNavTickRef.current = productsNavTick;
      if (productsSubTab === 'add_product') {
        initAddProductForm();
      } else if (productsSubTab === 'add_category') {
        initAddCategoryForm();
      } else {
        setEditingProduct(null);
        setEditingCategory(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productsNavTick, productsSubTab]);

  const openAddProductPage = () => {
    initAddProductForm();
    setProductsSubTab('add_product');
  };

  const openEditProductPage = (p: Product) => {
    setEditingProduct(p);
    const pShopId = p.shopId && visibleShopIdSet.has(p.shopId) ? p.shopId : shops[0]?.id || '';
    setProductShopId(pShopId);
    setName(p.name);
    setVariation(p.variation || '');
    setSku(p.sku);
    setBarcode(p.barcode);
    setCategoryId(p.categoryId);
    setPurchasePrice(p.purchasePrice.toString());
    setSellingPrice(p.sellingPrice.toString());
    setCurrentStock(p.currentStock.toString());
    setMinStock(p.minStock.toString());
    setUnit(p.unit);
    setProductImages(p.images || []);
    setDestinationType('SHOP_FLOOR');
    setSelectedStoreId('');
    setFormError('');
    setProductsSubTab('add_product');
  };

  const handleCancelProductForm = () => {
    setEditingProduct(null);
    setFormError('');
    setProductsSubTab('product_list');
  };

  const handleProductShopChange = (newShopId: string) => {
    setProductShopId(newShopId);
    const shopCats = categories.filter(c => c.shopId === newShopId && c.status !== 'INACTIVE');
    if (shopCats.length > 0 && !shopCats.some(c => c.id === categoryId)) {
      setCategoryId(shopCats[0].id);
    }
    const shopStores = (dbState.stores || []).filter(
      st => st.shopId === newShopId && st.status === 'ACTIVE' && !st.isShopFloor
    );
    setSelectedStoreId(shopStores[0]?.id || '');
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setIsSaving(true);

    if (!name.trim()) {
      setFormError('Product title is required.');
      setIsSaving(false);
      return;
    }

    if (!productShopId) {
      setFormError('Please select a shop/business unit for this product.');
      setIsSaving(false);
      return;
    }

    const sPrice = parseFloat(sellingPrice) || 0;
    const pPrice = parseFloat(purchasePrice) || 0;

    if (isNaN(sPrice) || sPrice < 0) {
      setFormError('Please enter a valid selling price.');
      setIsSaving(false);
      return;
    }

    try {
      let result;

      if (editingProduct) {
        const parsedMinStock = parseInt(minStock, 10);
        result = await ProductService.updateProduct(
          editingProduct.id,
          {
            shopId: productShopId,
            name,
            variation: variation.trim() || undefined,
            sku: sku.trim(),
            barcode: barcode.trim(),
            categoryId,
            purchasePrice: pPrice,
            sellingPrice: sPrice,
            currentStock: parseInt(currentStock, 10) || 0,
            minStock: Number.isFinite(parsedMinStock) && parsedMinStock >= 0 ? parsedMinStock : 0,
            unit,
            images: productImages,
          },
          currentUser
        );
      } else {
        if (destinationType === 'STORE' && !selectedStoreId) {
          setFormError('Please select a destination store or switch to Direct to Shop Floor.');
          setIsSaving(false);
          return;
        }
        const parsedMinStock = parseInt(minStock, 10);
        result = await ProductService.createProduct(
          {
            shopId: productShopId,
            storeId: destinationType === 'STORE' ? selectedStoreId : undefined,
            name,
            variation: variation.trim() || undefined,
            sku: sku.trim() || undefined,
            barcode: barcode.trim() || undefined,
            categoryId,
            purchasePrice: pPrice,
            sellingPrice: sPrice,
            currentStock: parseInt(currentStock, 10) || 0,
            minStock: Number.isFinite(parsedMinStock) && parsedMinStock >= 0 ? parsedMinStock : 0,
            unit,
            images: productImages,
          },
          currentUser
        );
      }

      if (result.success) {
        addToast({
          type: 'success',
          title: editingProduct ? 'Product Updated' : 'Product Created',
          description: editingProduct
            ? `'${name}' details updated.`
            : `'${name}' added to inventory catalog.`,
        });
        setEditingProduct(null);
        setProductsSubTab('product_list');
      } else {
        setFormError(result.error || 'Failed to save product.');
      }
    } catch (error: any) {
      console.error('Save product error:', error);
      setFormError(error.message || 'An error occurred while saving product.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (p: Product) => {
    const newStatus = p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const res = await ProductService.toggleProductStatus(p.id, newStatus, currentUser);
    if (res.success) {
      addToast({
        type: 'info',
        title: `Product ${newStatus === 'ACTIVE' ? 'Activated' : 'Deactivated'}`,
        description: `'${p.name}' is now ${newStatus}. Preserved in history.`,
      });
    } else if (res.error) {
      addToast({
        type: 'error',
        title: 'Status Change Failed',
        description: res.error,
      });
    }
  };

  const handleDeleteProduct = () => {
    if (!deletingProduct || !currentUser) return;

    const res = ProductService.deleteProduct(deletingProduct.id, currentUser);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Product Deleted',
        description: `'${deletingProduct.name}' has been permanently deleted.`,
      });
    } else {
      addToast({
        type: 'error',
        title: 'Delete Failed',
        description: res.error || 'Could not delete product.',
      });
    }
    setDeletingProduct(null);
  };

  // Category Actions
  const openAddCategoryPage = (targetShopId?: string) => {
    initAddCategoryForm(targetShopId);
    setProductsSubTab('add_category');
  };

  // Inline quick category modal (used from inside Add Product form without losing product inputs)
  const openQuickCategoryModal = (targetShopId?: string) => {
    initAddCategoryForm(targetShopId);
    setIsCategoryModalOpen(true);
  };

  const openEditCategoryPage = (cat: Category) => {
    setEditingCategory(cat);
    setCatShopIdInput(
      cat.shopId && visibleShopIdSet.has(cat.shopId) ? cat.shopId : shops[0]?.id || ''
    );
    setCatNameInput(cat.name);
    setCatColorInput(cat.color || '#3b82f6');
    setCatModalError('');
    setProductsSubTab('add_category');
  };

  const handleCancelCategoryForm = () => {
    setEditingCategory(null);
    setCatModalError('');
    setProductsSubTab('category_list');
  };

  const handleSaveCategory = (e: React.FormEvent) => {
    e.preventDefault();
    setCatModalError('');

    if (!catNameInput.trim()) {
      setCatModalError('Category name is required.');
      return;
    }

    if (!catShopIdInput) {
      setCatModalError('Please select a specific shop for this category.');
      return;
    }

    if (editingCategory) {
      const res = CategoryService.updateCategory(
        editingCategory.id,
        { name: catNameInput.trim(), shopId: catShopIdInput, color: catColorInput },
        currentUser
      );
      if (res.success) {
        addToast({
          type: 'success',
          title: 'Category Updated',
          description: `Category '${catNameInput}' updated.`,
        });
        setEditingCategory(null);
        setIsCategoryModalOpen(false);
        setProductsSubTab('category_list');
      } else {
        setCatModalError(res.error || 'Failed to update category.');
      }
    } else {
      const res = CategoryService.createCategory(
        { name: catNameInput.trim(), shopId: catShopIdInput, color: catColorInput },
        currentUser
      );
      if (res.success) {
        addToast({
          type: 'success',
          title: 'Category Created',
          description: `New category '${catNameInput}' created.`,
        });
        if (isCategoryModalOpen) {
          // Inline modal from Add Product form — select newly created category & stay on product form
          if (res.category?.id && catShopIdInput === productShopId) {
            setCategoryId(res.category.id);
          }
          setIsCategoryModalOpen(false);
        } else {
          setProductsSubTab('category_list');
        }
      } else {
        setCatModalError(res.error || 'Failed to create category.');
      }
    }
  };

  const handleToggleCategoryStatus = (cat: Category) => {
    const res = CategoryService.toggleCategoryStatus(cat.id, currentUser);
    if (res.success) {
      addToast({
        type: 'info',
        title: 'Category Status Updated',
        description: `Category '${cat.name}' is now ${
          cat.status === 'INACTIVE' ? 'Active' : 'Inactive'
        }.`,
      });
    } else if (res.error) {
      addToast({
        type: 'error',
        title: 'Update Failed',
        description: res.error,
      });
    }
  };

  const canEdit = hasAdminAccess(currentUser) || currentUser.permissions?.canEditProducts;
  const canDelete = hasAdminAccess(currentUser) || currentUser.permissions?.canDeleteProducts;

  // ==============================
  // DESKTOP TABLE ROW RENDERER
  // ==============================
  const renderProductRow = (product: Product) => {
    const cat = categories.find(c => c.id === product.categoryId);
    const isLow = product.currentStock <= product.minStock;
    const proposedPrice = product.proposedSellingPrice || product.sellingPrice;
    const marginPct =
      proposedPrice > 0
        ? (((proposedPrice - product.purchasePrice) / proposedPrice) * 100).toFixed(1)
        : '0';
    const hasHistory =
      (product.historicalUnitsSold || 0) > 0 ||
      (product.historicalUnitsTransferred || 0) > 0 ||
      (product.historicalUnitsAdjusted || 0) > 0;

    return (
      <tr
        key={product.id}
        className={`hover:bg-slate-800/40 transition ${
          product.status === 'INACTIVE' ? 'opacity-55 bg-slate-950/40' : ''
        }`}
      >
        <td className="py-3.5 px-4 font-semibold text-white">
          <div className="flex items-center gap-3">
            <ProductThumbnail
              product={product}
              size="md"
              onClick={() => {
                setViewingProduct(product);
                setIsViewerOpen(true);
              }}
            />
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="truncate font-semibold">{product.name}</span>
                {product.variation && (
                  <span className="px-1.5 py-0.2 rounded bg-violet-500/15 text-violet-300 border border-violet-500/25 inline-flex items-center gap-0.5 text-[10px] font-semibold">
                    <Layers className="w-2.5 h-2.5" />
                    {product.variation}
                  </span>
                )}
              </div>
              {product.status === 'INACTIVE' && (
                <span className="inline-block text-[10px] font-normal text-rose-400 bg-rose-500/10 px-1.5 py-0.2 rounded border border-rose-500/20">
                  Deactivated / Hidden from POS
                </span>
              )}
              {hasHistory && (
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/25 border border-amber-500/20 text-[10px] font-normal text-amber-200/90">
                  <History className="w-3 h-3 text-amber-400 shrink-0" />
                  <span>{product.historicalNote || 'Historical date unavailable'}</span>
                  <span className="font-mono text-amber-300">
                    • Sold: {product.historicalUnitsSold || 0}
                  </span>
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="py-3.5 px-4 font-mono text-slate-400">
          <div>{product.sku}</div>
          <div className="text-[10px] text-slate-500">{product.barcode}</div>
        </td>
        <td className="py-3.5 px-4 text-slate-300">
          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-medium border border-slate-700/60">
            {cat?.name || 'General'}
          </span>
        </td>
        <td className="py-3.5 px-4 text-right font-mono text-slate-400">
          {formatCurrency(product.purchasePrice, settings.currencySymbol)}
        </td>
        <td className="py-3.5 px-4 text-right font-mono font-bold text-white">
          {formatCurrency(proposedPrice, settings.currencySymbol)}
        </td>
        <td className="py-3.5 px-4 text-right font-mono text-emerald-400 font-semibold">
          {marginPct}%
        </td>
        <td className="py-3.5 px-4 text-center">
          <div className="inline-flex flex-col items-center gap-1">
            <span
              className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] tabular-nums ${
                product.currentStock <= 0
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : isLow
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'bg-emerald-500/15 text-emerald-300'
              }`}
            >
              {product.currentStock} {product.unit}
            </span>
            {(product.storeStock || 0) > 0 && (
              <span className="font-mono text-[10px] text-blue-400 tabular-nums">
                Store: {product.storeStock} {product.unit}
              </span>
            )}
            {product.storeStocks && Object.keys(product.storeStocks).length > 0 && (
              <div className="flex flex-wrap justify-center gap-1 text-[9px] max-w-[180px]">
                {Object.entries(product.storeStocks).map(([sid, qty]) => {
                  const st = (dbState.stores || []).find(s => s.id === sid);
                  if (!st && !qty) return null;
                  return (
                    <span
                      key={sid}
                      className="px-1.5 py-0.2 rounded bg-slate-950 border border-slate-800 text-slate-300 font-mono"
                    >
                      {st?.name || 'Store'}: {qty}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </td>
        <td className="py-3.5 px-4 text-center">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              product.status === 'ACTIVE'
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
            }`}
          >
            {product.status}
          </span>
        </td>
        <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
          {canEdit && (
            <>
              <button
                onClick={() => openEditProductPage(product)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                title="Edit product"
              >
                <Edit className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleToggleStatus(product)}
                className={`p-1.5 rounded-lg transition ${
                  product.status === 'ACTIVE'
                    ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400'
                    : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400'
                }`}
                title={product.status === 'ACTIVE' ? 'Deactivate Product' : 'Activate Product'}
              >
                <Power className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          {canDelete && (
            <button
              onClick={() => setDeletingProduct(product)}
              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition"
              title="Delete product"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </td>
      </tr>
    );
  };

  // ==============================
  // MOBILE PRODUCT CARD
  // ==============================
  const renderProductCard = (product: Product) => {
    const cat = categories.find(c => c.id === product.categoryId);
    const isLow = product.currentStock <= product.minStock;
    const proposedPrice = product.proposedSellingPrice || product.sellingPrice;
    const marginPct =
      proposedPrice > 0
        ? (((proposedPrice - product.purchasePrice) / proposedPrice) * 100).toFixed(1)
        : '0';

    return (
      <div
        key={product.id}
        className={`p-3.5 space-y-2.5 ${
          product.status === 'INACTIVE' ? 'opacity-55 bg-slate-950/40' : ''
        }`}
      >
        <div className="flex items-start gap-3">
          <ProductThumbnail
            product={product}
            size="md"
            onClick={() => {
              setViewingProduct(product);
              setIsViewerOpen(true);
            }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-bold text-xs text-white truncate">{product.name}</h4>
              <span
                className={`px-1.5 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                  product.status === 'ACTIVE'
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                    : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                }`}
              >
                {product.status}
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10px]">
              <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                {cat?.name || 'General'}
              </span>
              {product.variation && (
                <span className="px-1.5 py-0.2 rounded bg-violet-500/15 text-violet-300 border border-violet-500/25 inline-flex items-center gap-0.5 font-semibold">
                  <Layers className="w-2.5 h-2.5" />
                  {product.variation}
                </span>
              )}
              {product.sku && (
                <span className="font-mono text-slate-400">SKU: {product.sku}</span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs py-1">
          <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800">
            <div className="text-[9px] text-slate-400">Buying</div>
            <div className="font-mono text-[11px] text-slate-400">
              {formatCurrency(product.purchasePrice, settings.currencySymbol)}
            </div>
          </div>
          <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800">
            <div className="text-[9px] text-slate-400">Selling</div>
            <div className="font-mono text-[11px] font-bold text-white">
              {formatCurrency(proposedPrice, settings.currencySymbol)}
            </div>
          </div>
          <div className="bg-slate-950/60 p-1.5 rounded-lg border border-slate-800">
            <div className="text-[9px] text-slate-400">
              {(product.storeStock || 0) > 0 ? 'Floor / Store' : 'Stock'}
            </div>
            <div
              className={`font-mono text-[11px] font-bold tabular-nums ${
                product.currentStock <= 0
                  ? 'text-rose-400'
                  : isLow
                  ? 'text-amber-300'
                  : 'text-emerald-400'
              }`}
            >
              {product.currentStock} {product.unit}
            </div>
            {(product.storeStock || 0) > 0 && (
              <div className="font-mono text-[10px] text-blue-400 tabular-nums mt-0.5">
                Store: {product.storeStock} {product.unit}
              </div>
            )}
          </div>
        </div>

        {product.storeStocks && Object.keys(product.storeStocks).length > 0 && (
          <div className="flex flex-wrap gap-1 text-[10px]">
            {Object.entries(product.storeStocks).map(([sid, qty]) => {
              const st = (dbState.stores || []).find(s => s.id === sid);
              if (!st && !qty) return null;
              return (
                <span
                  key={sid}
                  className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300 font-mono"
                >
                  {st?.name || 'Store'}: {qty}
                </span>
              );
            })}
          </div>
        )}

        {((product.historicalUnitsSold || 0) > 0 ||
          (product.historicalUnitsTransferred || 0) > 0 ||
          (product.historicalUnitsAdjusted || 0) > 0) && (
          <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-amber-950/20 border border-amber-500/20 text-[10px] text-amber-200/90">
            <span className="inline-flex items-center gap-1">
              <History className="w-3 h-3 text-amber-400" />
              {product.historicalNote || 'Historical date unavailable'}
            </span>
            <span className="font-mono">
              Sold: {product.historicalUnitsSold || 0}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-xs">
          <div className="text-[11px] text-emerald-400 font-mono">
            Margin: <strong>{marginPct}%</strong>
          </div>

          <div className="flex items-center gap-1.5">
            {canEdit && (
              <>
                <button
                  onClick={() => openEditProductPage(product)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 text-xs font-semibold flex items-center gap-1 transition"
                >
                  <Edit className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
                <button
                  onClick={() => handleToggleStatus(product)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                    product.status === 'ACTIVE'
                      ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20'
                      : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{product.status === 'ACTIVE' ? 'Off' : 'On'}</span>
                </button>
              </>
            )}
            {canDelete && (
              <button
                onClick={() => setDeletingProduct(product)}
                className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 active:bg-rose-500/30 text-rose-400 transition"
                title="Delete product"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Inline Quick Category Modal (shared with Add Product page)
  const quickCategoryModal = isCategoryModalOpen ? (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2">
            <FolderTree className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">Create Category</h3>
          </div>
          <button
            onClick={() => setIsCategoryModalOpen(false)}
            className="text-slate-400 hover:text-white p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {catModalError && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{catModalError}</span>
          </div>
        )}

        <form onSubmit={handleSaveCategory} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Shop *</label>
            <select
              value={catShopIdInput}
              onChange={e => setCatShopIdInput(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="" disabled>
                Select target shop...
              </option>
              {shops.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code || 'UNIT'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Category Name *</label>
            <input
              type="text"
              required
              value={catNameInput}
              onChange={e => setCatNameInput(e.target.value)}
              placeholder="e.g. Plumbing, Tools, Paint..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Color Theme</label>
            <div className="flex items-center gap-2 flex-wrap">
              {[
                '#3b82f6',
                '#10b981',
                '#f59e0b',
                '#ec4899',
                '#8b5cf6',
                '#06b6d4',
                '#64748b',
              ].map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setCatColorInput(color)}
                  className={`w-8 h-8 rounded-full transition flex items-center justify-center ${
                    catColorInput === color
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: color }}
                >
                  {catColorInput === color && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsCategoryModalOpen(false)}
              className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow transition"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  // ─────────────────────────────────────────────────────────────
  // VIEW 1: FULL-PAGE ADD / EDIT PRODUCT
  // ─────────────────────────────────────────────────────────────
  if (productsSubTab === 'add_product') {
    const activeShopStores = (dbState.stores || []).filter(
      st => st.shopId === productShopId && st.status === 'ACTIVE' && !st.isShopFloor
    );

    return (
      <div
        id="admin-products-add-page"
        className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-8"
      >
        <div className="w-full">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={handleCancelProductForm}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition shrink-0"
                title="Back to Product List"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-violet-400 shrink-0" />
                  <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
                    {editingProduct ? 'Edit Product' : 'Add Product'}
                  </h2>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {editingProduct
                    ? 'Update product pricing, stock levels, category, and images'
                    : 'Create a new product in your shop catalog with pricing and initial stock'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCancelProductForm}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-semibold transition shrink-0"
            >
              <Package className="w-3.5 h-3.5 text-violet-400" />
              <span>Product List</span>
            </button>
          </div>

          {formError && (
            <div className="mb-4 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <form
            onSubmit={handleSaveProduct}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4 text-xs"
          >
            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">
                Assigned Shop / Unit *
              </label>
              <select
                value={productShopId}
                onChange={e => handleProductShopChange(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select shop...</option>
                {shops.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code || 'UNIT'})
                  </option>
                ))}
              </select>
              {shops.length === 0 && (
                <p className="text-[10px] text-rose-400 mt-1">
                  No shops available. Create a shop first!
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Product Title *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Bosch Hammer Drill 650W"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Variation (Optional)
                </label>
                <input
                  type="text"
                  value={variation}
                  onChange={e => setVariation(e.target.value)}
                  placeholder="e.g. 12 Inch, Black"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Purchasing Price
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  value={purchasePrice}
                  onChange={e => setPurchasePrice(e.target.value)}
                  placeholder="0"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Selling Price *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  required
                  value={sellingPrice}
                  onChange={e => setSellingPrice(e.target.value)}
                  placeholder="0"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {!editingProduct && (
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
                <label className="block text-slate-300 font-semibold">Stock Destination *</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDestinationType('SHOP_FLOOR')}
                    className={`px-3 py-2.5 rounded-xl border text-left font-semibold transition ${
                      destinationType === 'SHOP_FLOOR'
                        ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Direct to Shop Floor
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDestinationType('STORE');
                      if (!selectedStoreId && activeShopStores.length > 0) {
                        setSelectedStoreId(activeShopStores[0].id);
                      }
                    }}
                    className={`px-3 py-2.5 rounded-xl border text-left font-semibold transition ${
                      destinationType === 'STORE'
                        ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Send to Store (Warehouse)
                  </button>
                </div>

                {destinationType === 'STORE' && (
                  <div>
                    <label className="block text-slate-400 text-[11px] mb-1">
                      Select Store (Warehouse) *
                    </label>
                    {activeShopStores.length > 0 ? (
                      <select
                        value={selectedStoreId}
                        onChange={e => setSelectedStoreId(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">Select destination store...</option>
                        {activeShopStores.map(st => (
                          <option key={st.id} value={st.id}>
                            {st.name}
                            {st.location ? ` — ${st.location}` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-[11px] text-amber-400 py-1">
                        No active stores exist for this shop yet. Create one in Stores &amp;
                        Transfers or choose Direct to Shop Floor.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  {editingProduct
                    ? 'Current Floor Stock'
                    : destinationType === 'STORE'
                      ? 'Initial Store Stock'
                      : 'Initial Shop Floor Stock'}
                </label>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={currentStock}
                  onChange={e => setCurrentStock(e.target.value)}
                  placeholder="0"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">Min Threshold</label>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={minStock}
                  onChange={e => setMinStock(e.target.value)}
                  placeholder="0"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-slate-300 font-semibold">Category *</label>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => openQuickCategoryModal(productShopId)}
                      className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5 font-semibold"
                    >
                      <Plus className="w-3 h-3" />
                      <span>New</span>
                    </button>
                  )}
                </div>
                <select
                  value={categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select category...</option>
                  {categories
                    .filter(
                      c =>
                        c.shopId === productShopId &&
                        (c.status !== 'INACTIVE' || c.id === categoryId)
                    )
                    .map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.status === 'INACTIVE' ? '(Inactive)' : ''}
                      </option>
                    ))}
                </select>
                {categories.filter(c => c.shopId === productShopId).length === 0 && (
                  <p className="text-[10px] text-amber-400 mt-1">
                    No categories exist for this shop yet. Click &quot;+ New&quot; above.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Unit of Measure *
                </label>
                <select
                  value={unit}
                  onChange={e => setUnit(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="pcs">Pieces (pcs)</option>
                  <option value="meter">Meter (m)</option>
                  <option value="pack">Pack</option>
                  <option value="box">Box</option>
                  <option value="kg">Kilogram (kg)</option>
                  <option value="pair">Pair</option>
                  <option value="roll">Roll</option>
                  <option value="liter">Liter</option>
                  <option value="set">Set</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">SKU / Code</label>
                <input
                  type="text"
                  value={sku}
                  onChange={e => setSku(e.target.value)}
                  placeholder="Auto if empty"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">Barcode</label>
                <input
                  type="text"
                  value={barcode}
                  onChange={e => setBarcode(e.target.value)}
                  placeholder="Scan or enter"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80">
              <ProductImageUpload
                images={productImages}
                onChange={setProductImages}
                productId={editingProduct?.id}
              />
            </div>

            <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={handleCancelProductForm}
                className="sm:w-40 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || shops.length === 0}
                className="flex-1 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold shadow-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>
                  {isSaving
                    ? 'Saving...'
                    : editingProduct
                      ? 'Save Changes'
                      : 'Create Product'}
                </span>
              </button>
            </div>
          </form>
        </div>

        {quickCategoryModal}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // VIEW 2: FULL-PAGE ADD / EDIT CATEGORY
  // ─────────────────────────────────────────────────────────────
  if (productsSubTab === 'add_category') {
    return (
      <div
        id="admin-categories-add-page"
        className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-8"
      >
        <div className="w-full">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={handleCancelCategoryForm}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition shrink-0"
                title="Back to Category List"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FolderPlus className="w-5 h-5 text-sky-400 shrink-0" />
                  <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
                    {editingCategory ? 'Edit Category' : 'Add Category'}
                  </h2>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {editingCategory
                    ? 'Update category details and color tag'
                    : 'Create a shop-specific product category to organize inventory'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCancelCategoryForm}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-semibold transition shrink-0"
            >
              <FolderTree className="w-3.5 h-3.5 text-amber-400" />
              <span>Category List</span>
            </button>
          </div>

          {catModalError && (
            <div className="mb-4 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{catModalError}</span>
            </div>
          )}

          <form
            onSubmit={handleSaveCategory}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4 text-xs"
          >
            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">Shop *</label>
              <select
                value={catShopIdInput}
                onChange={e => setCatShopIdInput(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="" disabled>
                  Select target shop...
                </option>
                {shops.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code || 'UNIT'})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Categories are strictly assigned to this specific shop.
              </p>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">Category Name *</label>
              <input
                type="text"
                required
                value={catNameInput}
                onChange={e => setCatNameInput(e.target.value)}
                placeholder="e.g. Plumbing, Tools, Paint..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">Color Theme</label>
              <div className="flex items-center gap-2.5 flex-wrap">
                {[
                  '#3b82f6',
                  '#10b981',
                  '#f59e0b',
                  '#ec4899',
                  '#8b5cf6',
                  '#06b6d4',
                  '#64748b',
                ].map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setCatColorInput(color)}
                    className={`w-9 h-9 rounded-full transition flex items-center justify-center ${
                      catColorInput === color
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: color }}
                  >
                    {catColorInput === color && <Check className="w-4 h-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={handleCancelCategoryForm}
                className="sm:w-40 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold shadow-lg transition flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>{editingCategory ? 'Save Changes' : 'Create Category'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const isCategoryListView = productsSubTab === 'category_list';

  return (
    <div
      id="admin-products-view"
      className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            {isCategoryListView ? 'Category List' : 'Product List'}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {isCategoryListView
              ? 'Manage shop-specific product categories and color tags'
              : 'Configure catalog pricing, active/deactivated items, and product classification'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs">
            <button
              onClick={() => setProductsSubTab('product_list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
                !isCategoryListView
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Product List</span>
            </button>
            <button
              onClick={() => setProductsSubTab('category_list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
                isCategoryListView
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
              <span>Category List</span>
              <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] font-mono">
                {categories.length}
              </span>
            </button>
          </div>

          {!isCategoryListView ? (
            canEdit && (
              <button
                id="admin-add-product-btn"
                onClick={openAddProductPage}
                className="flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-xs shadow-lg transition"
              >
                <Plus className="w-4 h-4" />
                <span>Add Product</span>
              </button>
            )
          ) : (
            canEdit && (
              <button
                onClick={() => openAddCategoryPage()}
                className="flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold text-xs shadow-lg transition"
              >
                <Plus className="w-4 h-4" />
                <span>Add Category</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* PRODUCTS LIST VIEW */}
      {!isCategoryListView && (
        <>
          {/* Filters */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-3.5 mb-5 flex flex-col md:flex-row md:items-center justify-between gap-2.5 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-1 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search name, variation, SKU, or barcode..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
                <select
                  value={shopFilter}
                  onChange={e => setShopFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ALL">
                    {shopAdmin && !platformAdmin
                      ? shops.length === 1
                        ? shops[0].name
                        : 'All Managed Shops'
                      : 'All Shops'}
                  </option>
                  {(platformAdmin || shops.length > 1) &&
                    shops.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="ACTIVE">Active Only</option>
                  <option value="INACTIVE">Inactive Only</option>
                </select>
              </div>

              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ALL">All Categories</option>
                {availableFilterCategories.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-slate-400 font-medium text-right shrink-0">
              Total: <span className="text-white font-bold">{products.length}</span>
            </div>
          </div>

          {/* Grouped by Shop */}
          {products.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl py-16 text-center text-slate-500">
              <Package className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="font-medium text-slate-400">
                No products match your criteria.
                {shops.length === 0 ? ' Create a shop first!' : ''}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {groupedByShop.map(({ shop, products: shopProducts }) => {
                const isCollapsed = collapsedShops.has(shop.id);
                const activeCount = shopProducts.filter(p => p.status === 'ACTIVE').length;
                const lowStockCount = shopProducts.filter(
                  p => p.status === 'ACTIVE' && p.currentStock <= p.minStock
                ).length;

                // Pagination
                const visibleCount = getVisibleCount(shop.id);
                const visibleProducts = shopProducts.slice(0, visibleCount);
                const hasMore = shopProducts.length > visibleCount;
                const remaining = shopProducts.length - visibleCount;
                const isLoading = loadingShops.has(shop.id);

                return (
                  <div
                    key={shop.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg"
                  >
                    {/* Shop Header */}
                    <button
                      onClick={() => toggleShopCollapse(shop.id)}
                      className="w-full flex items-center justify-between gap-3 p-3.5 sm:px-5 sm:py-4 bg-slate-900/80 hover:bg-slate-800/60 active:bg-slate-800 transition border-b border-slate-800"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                          <Store className="w-4 h-4 sm:w-5 sm:h-5" />
                        </div>
                        <div className="min-w-0 text-left">
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <h3 className="text-sm sm:text-base font-bold text-white truncate">
                              {shop.name}
                            </h3>
                            <span className="px-1.5 sm:px-2 py-0.2 sm:py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                              {shop.code || 'UNIT'}
                            </span>
                            {shop.status === 'INACTIVE' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/20">
                                Shop Inactive
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                            {shopProducts.length}{' '}
                            {shopProducts.length === 1 ? 'product' : 'products'} •{' '}
                            {activeCount} active
                            {lowStockCount > 0 && (
                              <span className="text-amber-400 ml-1">
                                • {lowStockCount} low stock
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                        {lowStockCount > 0 && (
                          <span className="px-1.5 sm:px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[9px] sm:text-[10px] font-bold border border-amber-500/30">
                            ⚠ {lowStockCount} Low
                          </span>
                        )}
                        {isCollapsed ? (
                          <ChevronRight className="w-5 h-5 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {/* Products Table - Desktop */}
                    {!isCollapsed && (
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                              <th className="py-3 px-4 font-semibold">Product Name</th>
                              <th className="py-3 px-4 font-semibold">SKU / Barcode</th>
                              <th className="py-3 px-4 font-semibold">Category</th>
                              <th className="py-3 px-4 text-right font-semibold">Buying</th>
                              <th className="py-3 px-4 text-right font-semibold">Selling</th>
                              <th className="py-3 px-4 text-right font-semibold">Margin</th>
                              <th className="py-3 px-4 text-center font-semibold">
                                Floor / Store
                              </th>
                              <th className="py-3 px-4 text-center font-semibold">Status</th>
                              <th className="py-3 px-4 text-right font-semibold">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {visibleProducts.map(renderProductRow)}
                          </tbody>
                        </table>

                        {/* Desktop See More / See Less */}
                        {shopProducts.length > PAGE_SIZE && (
                          <div className="px-5 py-3 border-t border-slate-800/60 bg-slate-950/30 flex items-center justify-between gap-3">
                            <div className="text-[11px] text-slate-500">
                              Showing{' '}
                              <span className="text-slate-300 font-semibold">
                                {Math.min(visibleCount, shopProducts.length)}
                              </span>{' '}
                              of{' '}
                              <span className="text-slate-300 font-semibold">
                                {shopProducts.length}
                              </span>{' '}
                              products
                            </div>
                            <div className="flex items-center gap-2">
                              {visibleCount > PAGE_SIZE && (
                                <button
                                  onClick={() => handleSeeLess(shop.id)}
                                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                                >
                                  Show Less
                                </button>
                              )}
                              {hasMore && (
                                <button
                                  onClick={() => handleSeeMore(shop.id)}
                                  disabled={isLoading}
                                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold shadow transition disabled:opacity-60 disabled:cursor-wait"
                                >
                                  {isLoading ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      <span>Loading...</span>
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown className="w-3.5 h-3.5" />
                                      <span>
                                        See More ({Math.min(PAGE_SIZE, remaining)} of {remaining})
                                      </span>
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Products Cards - Mobile */}
                    {!isCollapsed && (
                      <div className="md:hidden">
                        <div className="divide-y divide-slate-800/80">
                          {visibleProducts.map(renderProductCard)}
                        </div>

                        {shopProducts.length > PAGE_SIZE && (
                          <div className="p-3 bg-slate-950/40 border-t border-slate-800/80 space-y-2">
                            <div className="text-[10px] text-slate-500 text-center">
                              Showing{' '}
                              <span className="text-slate-300 font-semibold">
                                {Math.min(visibleCount, shopProducts.length)}
                              </span>{' '}
                              of{' '}
                              <span className="text-slate-300 font-semibold">
                                {shopProducts.length}
                              </span>{' '}
                              products
                            </div>
                            <div className="flex items-center gap-2">
                              {visibleCount > PAGE_SIZE && (
                                <button
                                  onClick={() => handleSeeLess(shop.id)}
                                  className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 text-[11px] font-semibold transition"
                                >
                                  Show Less
                                </button>
                              )}
                              {hasMore && (
                                <button
                                  onClick={() => handleSeeMore(shop.id)}
                                  disabled={isLoading}
                                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-[11px] font-semibold shadow transition disabled:opacity-60 disabled:cursor-wait"
                                >
                                  {isLoading ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      <span>Loading...</span>
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown className="w-3.5 h-3.5" />
                                      <span>
                                        See More ({Math.min(PAGE_SIZE, remaining)})
                                      </span>
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Unassigned Products */}
              {productsWithNoShop.length > 0 && (
                <div className="bg-slate-900 border border-amber-800/40 rounded-2xl overflow-hidden shadow-lg">
                  <div className="flex items-center gap-2.5 p-3.5 sm:px-5 sm:py-4 bg-amber-950/20 border-b border-amber-800/40">
                    <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-white">
                        Unassigned Products
                      </h3>
                      <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                        {productsWithNoShop.length} products have an invalid shop
                      </p>
                    </div>
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                          <th className="py-3 px-4 font-semibold">Product Name</th>
                          <th className="py-3 px-4 font-semibold">SKU / Barcode</th>
                          <th className="py-3 px-4 font-semibold">Category</th>
                          <th className="py-3 px-4 text-right font-semibold">Buying</th>
                          <th className="py-3 px-4 text-right font-semibold">Selling</th>
                          <th className="py-3 px-4 text-right font-semibold">Margin</th>
                          <th className="py-3 px-4 text-center font-semibold">Floor / Store</th>
                          <th className="py-3 px-4 text-center font-semibold">Status</th>
                          <th className="py-3 px-4 text-right font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {productsWithNoShop.map(renderProductRow)}
                      </tbody>
                    </table>
                  </div>
                  <div className="md:hidden divide-y divide-slate-800/80">
                    {productsWithNoShop.map(renderProductCard)}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* CATEGORIES LIST VIEW */}
      {isCategoryListView && (
        <div className="space-y-4">
          {/* Header + Shop filter chips */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 sm:p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <FolderTree className="w-4 h-4 text-emerald-400" />
                  <span>Shop-Specific Categories</span>
                </h3>
                <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                  Every category is assigned to a specific shop to keep products classified and
                  isolated.
                </p>
              </div>

              {canEdit && (
                <button
                  onClick={() =>
                    openAddCategoryPage(
                      categoryShopFilter === 'ALL' ? undefined : categoryShopFilter
                    )
                  }
                  className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold text-xs transition shadow-sm shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Category</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs overflow-x-auto">
              <button
                onClick={() => setCategoryShopFilter('ALL')}
                className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
                  categoryShopFilter === 'ALL'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All ({categories.length})
              </button>
              {shops.map(s => {
                const count = categories.filter(c => c.shopId === s.id).length;
                return (
                  <button
                    key={s.id}
                    onClick={() => setCategoryShopFilter(s.id)}
                    className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
                      categoryShopFilter === s.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {s.name} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Category sections grouped by shop */}
          {shops.length === 0 ? (
            <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-xl text-slate-500">
              <FolderTree className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No shops exist. Create a shop first!</p>
            </div>
          ) : categories.length === 0 ? (
            <div className="p-8 text-center bg-slate-900 border border-slate-800 rounded-xl text-slate-500">
              <FolderTree className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No categories yet. Create your first category!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {shops
                .filter(
                  shop =>
                    categoryShopFilter === 'ALL' || categoryShopFilter === shop.id
                )
                .map(shop => {
                  const shopCats = categories.filter(c => c.shopId === shop.id);
                  const totalShopProducts = allProducts.filter(
                    p => p.shopId === shop.id
                  ).length;

                  return (
                    <div
                      key={shop.id}
                      className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-4 sm:p-5 space-y-3"
                    >
                      <div className="flex items-center gap-3 pb-3 border-b border-slate-800/80">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center font-bold shrink-0">
                          <Store className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-bold text-white truncate">
                              {shop.name}
                            </h4>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                              {shop.code || 'UNIT'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {shopCats.length}{' '}
                            {shopCats.length === 1 ? 'Category' : 'Categories'} •{' '}
                            {totalShopProducts} Products
                          </p>
                        </div>
                      </div>

                      {shopCats.length === 0 ? (
                        <div className="p-6 text-center bg-slate-950/40 rounded-xl border border-dashed border-slate-800 text-slate-500">
                          <Tag className="w-6 h-6 mx-auto mb-2 opacity-40" />
                          <p className="text-xs text-slate-400">
                            No categories yet for {shop.name}.
                          </p>
                          {canEdit && (
                            <button
                              onClick={() => openAddCategoryPage(shop.id)}
                              className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold transition"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Create First Category</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {shopCats.map(cat => {
                            const productCount = allProducts.filter(
                              p => p.categoryId === cat.id && p.shopId === shop.id
                            ).length;
                            const isActive = cat.status !== 'INACTIVE';

                            return (
                              <div
                                key={cat.id}
                                className={`bg-slate-950/70 border rounded-xl p-3.5 space-y-3 ${
                                  isActive
                                    ? 'border-slate-800'
                                    : 'border-slate-800/60 opacity-60'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <div
                                      className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xs shrink-0 shadow"
                                      style={{ backgroundColor: cat.color || '#3b82f6' }}
                                    >
                                      <Tag className="w-3.5 h-3.5" />
                                    </div>
                                    <div className="min-w-0">
                                      <h5 className="text-xs font-bold text-white truncate">
                                        {cat.name}
                                      </h5>
                                      <p className="text-[10px] text-slate-400 mt-0.5">
                                        {productCount}{' '}
                                        {productCount === 1 ? 'Product' : 'Products'}
                                      </p>
                                    </div>
                                  </div>

                                  <span
                                    className={`px-1.5 py-0.2 text-[9px] font-bold rounded-full shrink-0 ${
                                      isActive
                                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                        : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                                    }`}
                                  >
                                    {isActive ? 'Active' : 'Inactive'}
                                  </span>
                                </div>

                                {canEdit && (
                                  <div className="flex items-center gap-1.5 pt-2.5 border-t border-slate-800/80">
                                    <button
                                      onClick={() => openEditCategoryPage(cat)}
                                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 text-xs font-semibold transition"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => handleToggleCategoryStatus(cat)}
                                      className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                                        isActive
                                          ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300'
                                          : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300'
                                      }`}
                                    >
                                      {isActive ? 'Deactivate' : 'Activate'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Delete Product Confirmation */}
      {deletingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2 text-rose-400">
                <Trash2 className="w-5 h-5" />
                <h3 className="text-base font-bold text-white">Delete Product?</h3>
              </div>
              <button
                onClick={() => setDeletingProduct(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-200 text-xs mb-4">
              <strong>Warning:</strong> This action is permanent and cannot be undone.
            </div>

            <p className="text-xs text-slate-400 mb-4">
              Are you sure you want to delete{' '}
              <strong className="text-white">{deletingProduct.name}</strong>?
              <br />
              <br />
              This will permanently remove the product from all shops and delete its images.
            </p>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                onClick={() => setDeletingProduct(null)}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProduct}
                className="px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition"
              >
                Delete Product
              </button>
            </div>
          </div>
        </div>
      )}

      {quickCategoryModal}

      <ProductImageViewerModal
        product={viewingProduct}
        isOpen={isViewerOpen}
        onClose={() => setIsViewerOpen(false)}
        currencySymbol={settings.currencySymbol}
      />
    </div>
  );
};

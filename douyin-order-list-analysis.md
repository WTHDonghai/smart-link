
## 订单列表页面

URL： 
[订单列表页面](https://life.douyin.com/p/liteapp/fulfillment-workbench/hotel-book/list?groupid=1739040095277133&life_account_biz_ids=&life_biz_view_id=22&status=waiting)


新订单 和 取消退款 订单通过 两个 Tab 进行展示

点击 Tab 刷新出订单列表，即便重复点击 Tab 也能触发订单刷新

## 接口与元素定位

两类订单的接口返回的外层结构相同，数据来自于 “data": [json 字符串]
#### 接口返回的外层结构：

```json
{
  "code": 0,
  "BaseResp": {
    "StatusCode": 0,
    "StatusMessage": ""
  },
  "data": {
    "data": [
      "{\"order_base_info\":{...}, ...}"
    ],
    "pagination": {
      "page_index": 1,
      "page_size": 20,
      "total_count": 1
    }
  },
  "status_code": 0,
  "status_msg": ""
}
```
### 新订订单

#### Tab 元素定位参考：

```html
<div class="byted-tab-bar-item byted-tab-bar-item-type-line" draggable="false" elementtiming="element-timing"><span class="byted-tab-bar-item-label" elementtiming="element-timing"><span class="mr-0" elementtiming="element-timing"><span elementtiming="element-timing">新订/变更</span></span></span></div>
```

#### 新增订单列表接口：

`/life/trade_view/v1/workbench/book/query/list`

#### 新订单列表接口真实返回参考：

```json
{
    "BaseResp": {
        "StatusCode": 0,
        "StatusMessage": ""
    },
    "data": {
        "data": [
            "{\"action_list\":[{\"action\":\"reject_book\",\"action_name\":\"拒单\",\"color_scheme\":\"\",\"disable\":false,\"disable_type\":0,\"hover\":\"\"},{\"action\":\"accept_book\",\"action_name\":\"接单\",\"color_scheme\":\"\",\"disable\":false,\"disable_type\":0,\"hover\":\"\"}],\"after_sale_info\":{\"can_refund_for_user\":null,\"is_hotel_early_checkout\":null,\"not_refund_reason\":null,\"send_sms_after_sale_type_list\":null},\"after_sale_info_v2\":{\"after_sale_info_list\":[],\"early_checkout_after_sale_id\":null,\"is_hotel_early_checkout\":null},\"amount_info\":{\"currency\":\"￥\",\"makeup_amount\":0,\"origin_amount\":72390,\"oversea_currency_style\":false,\"pay_amount\":70500,\"pay_discount_amount\":0},\"book_detail_info\":{\"book_apply_time\":1790262147,\"book_end_time\":1790265600,\"book_id\":\"800000522465461174916676823\",\"book_night_count\":1,\"book_order_id\":\"1113572317175416823\",\"book_room_count\":1,\"book_start_time\":1790179200,\"confirm_number\":{\"can_edit\":false,\"text\":\"\"},\"hotel_name\":\"淮安日月洲度假村(西游乐园店)\",\"is_first_day_reserved_room\":false,\"poi_life_account_id\":\"7130223634133092383\",\"remark_info\":{\"question_and_answer_list\":[],\"remark_info_str\":\"\"}},\"grey_info\":{\"after_sale_info_v2\":true,\"order_info_v2\":true,\"product_info_v2\":true,\"status_info_v2\":true,\"verify_info_v2\":true},\"guest_info\":{\"buyer\":{\"name\":\" \",\"phone\":\"\",\"phone_ciphertext\":\"MDYEDOU3oUBTRCY8Miqb9AQUtCyWVjvZE5GpmLTLxnAgIjD1McEEELZxoeh8o+HTWpCYRNkBD7o=\"},\"user_list\":[{\"name\":\"吕克\",\"phone\":\"*******9109\",\"phone_ciphertext\":\"MEEEDNIw2SdS1PFG/uBFqAQfi+mSz2esAAKIV6/QlDz3VxN/ez1uLFtaVQ2+zuO07AQQDIt07t9DEVb0pGfys9ZIFA==\"}]},\"meta_data\":{\"main_data_key\":\"hotel_book\",\"show_reason\":\"\",\"source\":1,\"sub_scene\":0,\"view_function\":\"list\",\"view_key\":\"workbench_hotel_book_list\",\"view_type\":\"hotel_book\",\"view_version\":\"workbench\"},\"modify_info_list\":{},\"order_base_info\":{\"order_id\":\"1113572432327416823\",\"order_tag_list\":[\"超值券\"],\"pay_time\":1790262266},\"order_info_v2\":{\"combo_product_info\":{\"combined_order_status\":\"\",\"combined_sku_name\":null},\"connect_users\":[{\"phone_ciphertext\":\"MDYEDFhJ7OJO2fWX3C9kLQQUUor4TRNb4iSs1V6qHW6N1qvw5BgEEMCnmElSgY4N8kE0XGFbwkI=\",\"phone_mask\":\"\"}],\"create_time\":1790262146,\"hotel_info\":{\"multi_book_remain_room_nights\":null,\"multi_book_total_room_nights\":null},\"pay_time\":1790262266,\"shop_order_id\":\"1113572432327416823\",\"theater_order_info\":{}},\"play_methods\":{\"is_book_dimension\":true,\"is_calendar_pkg\":false,\"is_early_morning_room\":false,\"is_ftz_order\":false,\"is_multi_booking\":false,\"is_negotiate_booking\":false},\"play_methods_v2\":{\"is_calendar_pkg\":false,\"is_cancel\":false,\"is_delivery_store_verify\":false,\"is_dynamic_voucher\":false,\"is_early_morning_room\":false,\"is_hotel_calendar\":false,\"is_hotel_presale\":true,\"is_movie_store_verify\":false},\"product_info_v2\":{\"currency\":\"￥\",\"is_oversea\":false,\"order_id\":\"1113572432327416823\",\"product_order_id\":\"1113572432327416823\",\"sku\":{\"amount\":72390,\"desc\":\"\",\"hotel_info\":{\"commodity_meal\":\"自助早餐（3份）\",\"commodity_meal_num\":1,\"commodity_play\":\"3D打印体验（1份），树屋探险乐园（1份），晨曦儿童乐园游玩（1份），文创伴手礼（1份），乐园观光车往返接送（1份），免费停车（1份），健身房（1份），自助洗衣房（1份），乐园指定文创店9折（1份）\",\"commodity_play_num\":9,\"commodity_room\":\"\",\"commodity_room_num\":0,\"commodity_ticket\":\"单人西游乐园门票一次入园（3份）\",\"commodity_ticket_num\":1,\"order_refund_policy\":\"整单未预约，顾客可随时申请退款，过期自动退全额\\n预约成功后，取消预约分阶段退款不同金额，规则如下\",\"order_refund_policy_priority\":\"\",\"room_sale_mode\":1},\"img_url\":\"https://p3-sign.douyinpic.com/tos-cn-i-hf2m9xxmck/168a47c70fb24f42b6f3f6abdd3a956a~tplv-shrink:400:0.image?lk3s=d3d1baa4\\u0026x-expires=1790283600\\u0026x-signature=ZBGfJ4kdN%2BmLaDP0k5wsiCNMhwM%3D\\u0026from=3553737380\",\"movie_info\":{},\"product_type_name\":\"预售券\",\"sale_specs\":\"\",\"theater_order_info\":{},\"title\":\"【中秋国庆享】错峰出游·中秋国庆可约｜豪华家庭房1晚含早+三人西游乐园+景区接驳+儿童活动\"},\"tags\":[\"超值券\"]},\"sale_product_info\":{\"commodity_meal\":\"自助早餐（3份）\",\"commodity_meal_num\":1,\"commodity_play\":\"3D打印体验（1份），树屋探险乐园（1份），晨曦儿童乐园游玩（1份），文创伴手礼（1份），乐园观光车往返接送（1份），免费停车（1份），健身房（1份），自助洗衣房（1份），乐园指定文创店9折（1份）\",\"commodity_play_num\":9,\"commodity_room\":\"\",\"commodity_room_num\":0,\"commodity_ticket\":\"单人西游乐园门票一次入园（3份）\",\"commodity_ticket_num\":1,\"physical_room_name\":\"豪华家庭房\",\"product_id\":\"1874909529933856\",\"product_name\":\"【中秋国庆享】错峰出游·中秋国庆可约｜豪华家庭房1晚含早+三人西游乐园+景区接驳+儿童活动\",\"product_tag\":[\"预售券\"],\"product_type\":12,\"product_type_name\":\"预售券\",\"room_sale_mode\":1},\"status_info\":{\"color_type\":\"primary\",\"count_down\":1790265866,\"list_status_arr\":[\"请在 \\u003c%c countDown %\\u003e 内接单\"],\"title\":\"新订\"},\"status_info_v2\":{\"color_type\":\"primary\",\"count_down\":1790265866,\"detail_desc_list\":[\"请在 \\u003c%c countDown %\\u003e 内处理，超时未处理订单将自动取消\"],\"hover\":false,\"list_desc_list\":[\"请在 \\u003c%c countDown %\\u003e 内接单\"],\"tip\":{\"content\":\"\"},\"title\":\"新订\"}}"
        ],
        "pagination": {
            "cursor": "1790262147000,1113572432327416823",
            "flag": 1,
            "has_more": false,
            "page_index": 1,
            "page_size": 20,
            "total_count": 1
        }
    },
    "log_id": "2026092423043148021F91B582273FDA5D",
    "now": "1790262271510",
    "status_code": 0,
    "status_msg": ""
}
```


#### 序列化之后的的订单列表数据root.data.data:

```json
{
  "action_list": [
    {
      "action": "reject_book",
      "action_name": "拒单",
      "color_scheme": "",
      "disable": false,
      "disable_type": 0,
      "hover": ""
    },
    {
      "action": "accept_book",
      "action_name": "接单",
      "color_scheme": "",
      "disable": false,
      "disable_type": 0,
      "hover": ""
    }
  ],
  "after_sale_info": {
    "can_refund_for_user": null,
    "is_hotel_early_checkout": null,
    "not_refund_reason": null,
    "send_sms_after_sale_type_list": null
  },
  "after_sale_info_v2": {
    "after_sale_info_list": [],
    "early_checkout_after_sale_id": null,
    "is_hotel_early_checkout": null
  },
  "amount_info": {
    "currency": "￥",
    "makeup_amount": 0,
    "origin_amount": 72390,
    "oversea_currency_style": false,
    "pay_amount": 70500,
    "pay_discount_amount": 0
  },
  "book_detail_info": {
    "book_apply_time": 1790262147,1113572317175416823
    "book_end_time": 1790265600,
    "book_id": "800000522465461174916676823",
    "book_night_count": 1,
    "book_order_id": "1113572317175416823",// 预约单号
    "book_room_count": 1,
    "book_start_time": 1790179200,
    "confirm_number": {
      "can_edit": false,
      "text": ""
    },
    "hotel_name": "淮安日月洲度假村(西游乐园店)",
    "is_first_day_reserved_room": false,
    "poi_life_account_id": "7130223634133092383",
    "remark_info": {
      "question_and_answer_list": [],
      "remark_info_str": ""
    }
  },
  "grey_info": {
    "after_sale_info_v2": true,
    "order_info_v2": true,
    "product_info_v2": true,
    "status_info_v2": true,
    "verify_info_v2": true
  },
  "guest_info": {
    "buyer": {
      "name": " ",
      "phone": "",
      "phone_ciphertext": "MDYEDOU3oUBTRCY8Miqb9AQUtCyWVjvZE5GpmLTLxnAgIjD1McEEELZxoeh8o+HTWpCYRNkBD7o="
    },
    "user_list": [
      {
        "name": "吕克",
        "phone": "*******9109",
        "phone_ciphertext": "MEEEDNIw2SdS1PFG/uBFqAQfi+mSz2esAAKIV6/QlDz3VxN/ez1uLFtaVQ2+zuO07AQQDIt07t9DEVb0pGfys9ZIFA=="
      }
    ]
  },
  "meta_data": {
    "main_data_key": "hotel_book",
    "show_reason": "",
    "source": 1,
    "sub_scene": 0,
    "view_function": "list",
    "view_key": "workbench_hotel_book_list",
    "view_type": "hotel_book",
    "view_version": "workbench"
  },
  "modify_info_list": {},
  "order_base_info": {
    "order_id": "1113572432327416823", // 订单编号
    "order_tag_list": [
      "超值券"
    ],
    "pay_time": 1790262266
  },
  "order_info_v2": {
    "combo_product_info": {
      "combined_order_status": "",
      "combined_sku_name": null
    },
    "connect_users": [
      {
        "phone_ciphertext": "MDYEDFhJ7OJO2fWX3C9kLQQUUor4TRNb4iSs1V6qHW6N1qvw5BgEEMCnmElSgY4N8kE0XGFbwkI=",
        "phone_mask": ""
      }
    ],
    "create_time": 1790262146,
    "hotel_info": {
      "multi_book_remain_room_nights": null,
      "multi_book_total_room_nights": null
    },
    "pay_time": 1790262266,
    "shop_order_id": "1113572432327416823",
    "theater_order_info": {}
  },
  "play_methods": {
    "is_book_dimension": true,
    "is_calendar_pkg": false,
    "is_early_morning_room": false,
    "is_ftz_order": false,
    "is_multi_booking": false,
    "is_negotiate_booking": false
  },
  "play_methods_v2": {
    "is_calendar_pkg": false,
    "is_cancel": false,
    "is_delivery_store_verify": false,
    "is_dynamic_voucher": false,
    "is_early_morning_room": false,
    "is_hotel_calendar": false,
    "is_hotel_presale": true,
    "is_movie_store_verify": false
  },
  "product_info_v2": {
    "currency": "￥",
    "is_oversea": false,
    "order_id": "1113572432327416823",
    "product_order_id": "1113572432327416823",
    "sku": {
      "amount": 72390,
      "desc": "",
      "hotel_info": {
        "commodity_meal": "自助早餐（3份）",
        "commodity_meal_num": 1,
        "commodity_play": "3D打印体验（1份），树屋探险乐园（1份），晨曦儿童乐园游玩（1份），文创伴手礼（1份），乐园观光车往返接送（1份），免费停车（1份），健身房（1份），自助洗衣房（1份），乐园指定文创店9折（1 份）",
        "commodity_play_num": 9,
        "commodity_room": "",
        "commodity_room_num": 0,
        "commodity_ticket": "单人西游乐园门票一次入园（3份）",
        "commodity_ticket_num": 1,
        "order_refund_policy": "整单未预约，顾客可随时申请退款，过期自动退全额\n预约成功后，取消预约分阶 段退款不同金额，规则如下",
        "order_refund_policy_priority": "",
        "room_sale_mode": 1
      },
      "img_url": "https://p3-sign.douyinpic.com/tos-cn-i-hf2m9xxmck/168a47c70fb24f42b6f3f6abdd3a956a~tplv-shrink:400:0.image?lk3s=d3d1baa4&x-expires=1790283600&x-signature=ZBGfJ4kdN%2BmLaDP0k5wsiCNMhwM%3D&from=3553737380",
      "movie_info": {},
      "product_type_name": "预售券",
      "sale_specs": "",
      "theater_order_info": {},
      "title": "【中秋国庆享】错峰出游·中秋国庆可约｜豪华家庭房1晚含早+三人西游乐园+景区接驳+儿童活动"
    },
    "tags": [
      "超值券"
    ]
  },
  "sale_product_info": {
    "commodity_meal": "自助早餐（3份）",
    "commodity_meal_num": 1,
    "commodity_play": "3D打印体验（1份），树屋探险乐园（1份），晨曦儿童乐园游玩（1份），文创伴手礼（1份），乐园观光车往返接送（1份），免费停车（1份），健身房（1份），自助洗衣房（1份），乐园指定文创店9折（1份）",
    "commodity_play_num": 9,
    "commodity_room": "",
    "commodity_room_num": 0,
    "commodity_ticket": "单人西游乐园门票一次入园（3份）",
    "commodity_ticket_num": 1,
    "physical_room_name": "豪华家庭房",
    "product_id": "1874909529933856",
    "product_name": "【中秋国庆享】错峰出游·中秋国庆可约｜豪华家庭房1晚含早+三人西游乐园+景区接驳+儿童活 动",
    "product_tag": [
      "预售券"
    ],
    "product_type": 12,
    "product_type_name": "预售券",
    "room_sale_mode": 1
  },
  "status_info": {
    "color_type": "primary",
    "count_down": 1790265866,
    "list_status_arr": [
      "请在 <%c countDown %> 内接单"
    ],
    "title": "新订"
  },
  "status_info_v2": {
    "color_type": "primary",
    "count_down": 1790265866,
    "detail_desc_list": [
      "请在 <%c countDown %> 内处理，超时未处理订单将自动取消"
    ],
    "hover": false,
    "list_desc_list": [
      "请在 <%c countDown %> 内接单"
    ],
    "tip": {
      "content": ""
    },
    "title": "新订"
  }
}
```

### 取消/退款订单

#### Tab 元素定位参考:

```html
<div class="byted-tab-bar-item byted-tab-bar-item-active byted-tab-bar-item-type-line" draggable="false" elementtiming="element-timing"><span class="byted-tab-bar-item-label" elementtiming="element-timing"><span class="mr-0" elementtiming="element-timing"><span elementtiming="element-timing">取消/退款</span></span></span></div>
```

#### 取消订单列表接口：

`/life/trade_view/v1/workbench/refund/query/hotel_after_sale_record_list`

#### 取消订单列表接口真实返回参考：

```json
{
    "BaseResp": {
        "StatusCode": 0,
        "StatusMessage": ""
    },
    "data": {
        "data": [
            "{\"action_list\":[{\"action\":\"clear_wait_confirm\",\"action_name\":\"我知道了\"},{\"action\":\"fill_confirm_number\",\"action_name\":\"填写酒店确认号\"},{\"action\":\"stuff_confirm_number\",\"action_name\":\"填写酒店确认号\"}],\"after_sale_info\":{\"after_sale_id\":\"768912266776597510130734527\",\"after_sale_type_enum\":2,\"audit_id\":\"768912269152575698936584527\",\"refund_reason\":[\"行程取消/改变\"]},\"after_sale_info_v2\":{\"after_sale_info\":{\"after_sale_id\":\"768912266776597510130734527\",\"after_sale_status\":50,\"after_sale_type\":\"取消预约\",\"after_sale_type_enum\":2,\"after_sale_type_struct\":{\"status_desc\":\"完成前\",\"type_desc\":\"仅取消预约\"},\"append_list\":[],\"applicant_type\":\"买家\",\"apply_time\":1790263401,\"complete_time\":1790263405,\"deduct_amount\":0,\"early_checkout_day\":null,\"img_url_list\":[],\"is_hotel_early_checkout\":false,\"last_checkout_end_day\":null,\"makeup_amount\":50000,\"makeup_amount_v2\":50000,\"origin_amount\":null,\"platform_no_reason_refund\":null,\"product_type\":13,\"refund_amount\":50000,\"refund_amount_comment\":\"预约加价\",\"refund_amount_detail\":[],\"refund_amount_detail_new\":{},\"refund_amount_type\":\"预约加价退款\",\"refund_desc\":\"\",\"refund_goods_info\":{},\"refund_num\":1,\"refund_num_unit\":\"晚\",\"refund_reason\":\"行程取消/改变\",\"refund_respondent\":0,\"relation_refund_amount\":0,\"relation_total_refund_amount\":0,\"single_refund_amount\":50000,\"single_total_refund_amount\":50000,\"travel_refund_detail_str\":\"\"}},\"amount_info\":{\"makeup_amount\":50000,\"refund_amount\":50000,\"refund_amount_type\":\"预约加价\",\"refund_amount_type_enum\":2},\"book_detail_info\":{\"book_apply_time\":1789439863,\"book_end_time\":1790870400,\"book_id\":\"800000263678588854916054527\",\"book_night_count\":1,\"book_order_id\":\"1112767046775414527\",\"book_room_count\":1,\"book_start_time\":1790784000,\"confirm_number\":{\"text\":\"2609150019\",\"can_edit\":true},\"hotel_name\":\"淮安日月洲度假村(西游乐园店)\"},\"grey_info\":{\"after_sale_info_v2\":true,\"order_info_v2\":true,\"product_info_v2\":true,\"status_info_v2\":true,\"verify_info_v2\":true},\"guest_info\":{\"buyer\":{\"name\":\"\",\"phone\":\"\"},\"user_list\":[{\"name\":\"王丽俐\",\"phone\":\"*******8890\",\"phone_ciphertext\":\"MEEEDGwYk0dGSvIeqqPVnAQfwEgtuGWr0WX5KgJVSy1I76xKO372bpPIlI58SidbGgQQN55G92ezllY55L8Adp4YMQ==\"}]},\"meta_data\":{\"main_data_key\":\"after_sale_main_data\",\"view_function\":\"list\",\"view_key\":\"after_sale_workbench_hotel_list\",\"view_type\":\"hotel_after_sale\",\"view_version\":\"workbench\"},\"order_base_info\":{\"order_id\":\"1112732801688054527\",\"order_tag_list\":[\"超值券\"]},\"order_info_v2\":{\"balance_deposit_info\":{},\"connect_users\":[{\"phone_mask\":\"\",\"show_mode\":\"\"}],\"create_time\":1789439861,\"pay_time\":1789439889,\"scenic_info\":{},\"shop_order_id\":\"1112732801688054527\"},\"play_methods\":{\"is_benefit_card\":false,\"is_calendar_pkg\":false,\"is_comprehensive_appointment\":false,\"is_comprehensive_film\":false,\"is_comprehensive_reserve\":false,\"is_early_morning_room\":false,\"is_equity_card\":false,\"is_hotel\":true,\"is_light_reserved\":false,\"is_mall\":false,\"is_pay_bill\":false,\"is_pick_up\":false,\"is_pick_up_combo\":false,\"is_pre_exchange\":false,\"is_scenic_calendar\":false,\"is_scenic_presale\":false,\"is_sxt_order\":false,\"is_times_card\":false,\"is_times_card_cycle\":false},\"play_methods_v2\":{\"is_benefit_card\":false,\"is_calendar_pkg\":false,\"is_cancel\":false,\"is_comprehensive_appointment\":false,\"is_comprehensive_reserve\":false,\"is_custom_travel\":false,\"is_delivery_store_verify\":false,\"is_dynamic_voucher\":false,\"is_early_morning_room\":false,\"is_equity_card\":false,\"is_hotel_calendar\":false,\"is_hotel_presale\":true,\"is_light_reserved\":false,\"is_mall\":false,\"is_movie_store_verify\":false,\"is_pay_bill\":false,\"is_pick_up\":false,\"is_pick_up_combo\":false,\"is_pre_exchange\":false,\"is_scenic\":false,\"is_scenic_calendar\":false,\"is_scenic_presale\":false,\"is_sxt_after_sale_order\":false,\"is_times_card\":false,\"is_times_card_cycle\":false,\"is_travel_calendar\":false,\"is_travel_presale\":false},\"product_info_v2\":{\"currency\":\"¥\",\"is_oversea\":false,\"order_id\":\"1112732801688054527\",\"product_order_id\":\"1112732801688054527\",\"sku_list\":[{\"amount\":72390,\"desc\":\"\",\"hotel_info\":{\"commodity_meal\":\"自助早餐（3份）\",\"commodity_meal_num\":1,\"commodity_play\":\"3D打印体验（1份），树屋探险乐园（1份），晨曦儿童乐园游玩（1份），文创伴手礼（1份），乐园观光车往返接送（1份），免费停车（1份），健身房（1份），自助洗衣房（1份），乐园指定文创店9折（1份）\",\"commodity_play_num\":9,\"commodity_room\":\"\",\"commodity_room_num\":0,\"commodity_ticket\":\"单人西游乐园门票一次入园（3份）\",\"commodity_ticket_num\":1,\"exchange_product_name\":\"\"},\"img_url\":\"https://p26-sign.douyinpic.com/tos-cn-i-hf2m9xxmck/168a47c70fb24f42b6f3f6abdd3a956a~tplv-shrink:400:0.image?lk3s=d3d1baa4\\u0026x-expires=1790283600\\u0026x-signature=ZTFNZVMNhjkSaLbY819edXnL%2FR8%3D\\u0026from=3553737380\",\"num\":1,\"product_type_name\":\"预售券\",\"sale_specs\":\"\",\"sku_id\":1874909529933856,\"title\":\"【中秋国庆享】错峰出游·中秋国庆可约｜豪华家庭房1晚含早+三人西游乐园+景区接驳+儿童活动\"}],\"tags\":[\"超值券\"]},\"sale_product_info\":{\"commodity_meal\":\"自助早餐（3份）\",\"commodity_meal_num\":1,\"commodity_play\":\"3D打印体验（1份），树屋探险乐园（1份），晨曦儿童乐园游玩（1份），文创伴手礼（1份），乐园观光车往返接送（1份），免费停车（1份），健身房（1份），自助洗衣房（1份），乐园指定文创店9折（1份）\",\"commodity_play_num\":9,\"commodity_room\":\"\",\"commodity_room_num\":0,\"commodity_ticket\":\"单人西游乐园门票一次入园（3份）\",\"commodity_ticket_num\":1,\"physical_room_name\":\"豪华家庭房\",\"product_id\":1874909529933856,\"product_name\":\"【中秋国庆享】错峰出游·中秋国庆可约｜豪华家庭房1晚含早+三人西游乐园+景区接驳+儿童活动\",\"room_sale_mode\":1},\"status_info\":{\"color_type\":\"default\",\"count_down\":0,\"detail_status_arr\":[\"平台自动同意取消，加价金额已原路退回顾客\"],\"hover\":false,\"list_status_arr\":[\"平台自动同意取消，加价金额已原路退回顾客\"],\"title\":\"已取消\"},\"status_info_v2\":{\"color_type\":\"default\",\"count_down\":0,\"detail_desc_list\":[\"平台自动同意取消，加价金额已原路退回顾客\"],\"detail_status_arr\":[\"平台自动同意取消，加价金额已原路退回顾客\"],\"hover\":false,\"list_desc_list\":[\"平台自动同意取消，加价金额已原路退回顾客\"],\"list_status_arr\":[\"平台自动同意取消，加价金额已原路退回顾客\"],\"title\":\"已取消\"}}"
        ],
        "detail": {
            "data": ""
        },
        "pagination": {
            "cursor": "1790263401,768912266776597510130734527",
            "flag": 1,
            "has_more": false,
            "page_index": 1,
            "page_size": 20,
            "total_count": 1
        }
    },
    "log_id": "",
    "now": "",
    "status_code": 0,
    "status_msg": ""
}
```

#### 序列化之后的的订单列表数据root.data.data:

```json
{
  "action_list": [
    {
      "action": "clear_wait_confirm",
      "action_name": "我知道了"
    },
    {
      "action": "fill_confirm_number",
      "action_name": "填写酒店确认号"
    },
    {
      "action": "stuff_confirm_number",
      "action_name": "填写酒店确认号"
    }
  ],
  "after_sale_info": {
    "after_sale_id": "768912266776597510130734527",
    "after_sale_type_enum": 2,
    "audit_id": "768912269152575698936584527",
    "refund_reason": [
      "行程取消/改变"
    ]
  },
  "after_sale_info_v2": {
    "after_sale_info": {
      "after_sale_id": "768912266776597510130734527",
      "after_sale_status": 50,
      "after_sale_type": "取消预约",
      "after_sale_type_enum": 2,
      "after_sale_type_struct": {
        "status_desc": "完成前",
        "type_desc": "仅取消预约"
      },
      "append_list": [],
      "applicant_type": "买家",
      "apply_time": 1790263401,
      "complete_time": 1790263405,
      "deduct_amount": 0,
      "early_checkout_day": null,
      "img_url_list": [],
      "is_hotel_early_checkout": false,
      "last_checkout_end_day": null,
      "makeup_amount": 50000,
      "makeup_amount_v2": 50000,
      "origin_amount": null,
      "platform_no_reason_refund": null,
      "product_type": 13,
      "refund_amount": 50000,
      "refund_amount_comment": "预约加价",
      "refund_amount_detail": [],
      "refund_amount_detail_new": {},
      "refund_amount_type": "预约加价退款",
      "refund_desc": "",
      "refund_goods_info": {},
      "refund_num": 1,
      "refund_num_unit": "晚",
      "refund_reason": "行程取消/改变",
      "refund_respondent": 0,
      "relation_refund_amount": 0,
      "relation_total_refund_amount": 0,
      "single_refund_amount": 50000,
      "single_total_refund_amount": 50000,
      "travel_refund_detail_str": ""
    }
  },
  "amount_info": {
    "makeup_amount": 50000,
    "refund_amount": 50000,
    "refund_amount_type": "预约加价",
    "refund_amount_type_enum": 2
  },
  "book_detail_info": {
    "book_apply_time": 1789439863,
    "book_end_time": 1790870400,
    "book_id": "800000263678588854916054527",
    "book_night_count": 1,
    "book_order_id": "1112767046775414527", // 预约单号
    "book_room_count": 1,
    "book_start_time": 1790784000,
    "confirm_number": {
      "text": "2609150019",
      "can_edit": true
    },
    "hotel_name": "淮安日月洲度假村(西游乐园店)"
  },
  "grey_info": {
    "after_sale_info_v2": true,
    "order_info_v2": true,
    "product_info_v2": true,
    "status_info_v2": true,
    "verify_info_v2": true
  },
  "guest_info": {
    "buyer": {
      "name": "",
      "phone": ""
    },
    "user_list": [
      {
        "name": "王丽俐",
        "phone": "*******8890",
        "phone_ciphertext": "MEEEDGwYk0dGSvIeqqPVnAQfwEgtuGWr0WX5KgJVSy1I76xKO372bpPIlI58SidbGgQQN55G92ezllY55L8Adp4YMQ=="
      }
    ]
  },
  "meta_data": {
    "main_data_key": "after_sale_main_data",
    "view_function": "list",
    "view_key": "after_sale_workbench_hotel_list",
    "view_type": "hotel_after_sale",
    "view_version": "workbench"
  },
  "order_base_info": {
    "order_id": "1112732801688054527", // 订单编号
    "order_tag_list": [
      "超值券"
    ]
  },
  "order_info_v2": {
    "balance_deposit_info": {},
    "connect_users": [
      {
        "phone_mask": "",
        "show_mode": ""
      }
    ],
    "create_time": 1789439861,
    "pay_time": 1789439889,
    "scenic_info": {},
    "shop_order_id": "1112732801688054527"
  },
  "play_methods": {
    "is_benefit_card": false,
    "is_calendar_pkg": false,
    "is_comprehensive_appointment": false,
    "is_comprehensive_film": false,
    "is_comprehensive_reserve": false,
    "is_early_morning_room": false,
    "is_equity_card": false,
    "is_hotel": true,
    "is_light_reserved": false,
    "is_mall": false,
    "is_pay_bill": false,
    "is_pick_up": false,
    "is_pick_up_combo": false,
    "is_pre_exchange": false,
    "is_scenic_calendar": false,
    "is_scenic_presale": false,
    "is_sxt_order": false,
    "is_times_card": false,
    "is_times_card_cycle": false
  },
  "play_methods_v2": {
    "is_benefit_card": false,
    "is_calendar_pkg": false,
    "is_cancel": false,
    "is_comprehensive_appointment": false,
    "is_comprehensive_reserve": false,
    "is_custom_travel": false,
    "is_delivery_store_verify": false,
    "is_dynamic_voucher": false,
    "is_early_morning_room": false,
    "is_equity_card": false,
    "is_hotel_calendar": false,
    "is_hotel_presale": true,
    "is_light_reserved": false,
    "is_mall": false,
    "is_movie_store_verify": false,
    "is_pay_bill": false,
    "is_pick_up": false,
    "is_pick_up_combo": false,
    "is_pre_exchange": false,
    "is_scenic": false,
    "is_scenic_calendar": false,
    "is_scenic_presale": false,
    "is_sxt_after_sale_order": false,
    "is_times_card": false,
    "is_times_card_cycle": false,
    "is_travel_calendar": false,
    "is_travel_presale": false
  },
  "product_info_v2": {
    "currency": "¥",
    "is_oversea": false,
    "order_id": "1112732801688054527",
    "product_order_id": "1112732801688054527",
    "sku_list": [
      {
        "amount": 72390,
        "desc": "",
        "hotel_info": {
          "commodity_meal": "自助早餐（3份）",
          "commodity_meal_num": 1,
          "commodity_play": "3D打印体验（1份），树屋探险乐园（1份），晨曦儿童乐园游玩（1份），文创伴手礼（1份），乐园观光车往返接送（1份），免费停车（1份），健身房（1份），自助洗衣房（1份），乐园指定文创店9折（1
份）",
          "commodity_play_num": 9,
          "commodity_room": "",
          "commodity_room_num": 0,
          "commodity_ticket": "单人西游乐园门票一次入园（3份）",
          "commodity_ticket_num": 1,
          "exchange_product_name": ""
        },
        "img_url": "https://p26-sign.douyinpic.com/tos-cn-i-hf2m9xxmck/168a47c70fb24f42b6f3f6abdd3a956a~tplv-shrink:400:0.image?lk3s=d3d1baa4&x-expires=1790283600&x-signature=ZTFNZVMNhjkSaLbY819edXnL%2FR8%3D&fro
m=3553737380",
        "num": 1,
        "product_type_name": "预售券",
        "sale_specs": "",
        "sku_id": 1874909529933856,
        "title": "【中秋国庆享】错峰出游·中秋国庆可约｜豪华家庭房1晚含早+三人西游乐园+景区接驳+儿童活动"
      }
    ],
    "tags": [
      "超值券"
    ]
  },
  "sale_product_info": {
    "commodity_meal": "自助早餐（3份）",
    "commodity_meal_num": 1,
    "commodity_play": "3D打印体验（1份），树屋探险乐园（1份），晨曦儿童乐园游玩（1份），文创伴手礼（1份），乐园观光车往返接送（1份），免费停车（1份），健身房（1份），自助洗衣房（1份），乐园指定文创店9折（1份）",
    "commodity_play_num": 9,
    "commodity_room": "",
    "commodity_room_num": 0,
    "commodity_ticket": "单人西游乐园门票一次入园（3份）",
    "commodity_ticket_num": 1,
    "physical_room_name": "豪华家庭房",
    "product_id": 1874909529933856,
    "product_name": "【中秋国庆享】错峰出游·中秋国庆可约｜豪华家庭房1晚含早+三人西游乐园+景区接驳+儿童活动",
    "room_sale_mode": 1
  },
  "status_info": {
    "color_type": "default",
    "count_down": 0,
    "detail_status_arr": [
      "平台自动同意取消，加价金额已原路退回顾客"
    ],
    "hover": false,
    "list_status_arr": [
      "平台自动同意取消，加价金额已原路退回顾客"
    ],
    "title": "已取消"
  },
  "status_info_v2": {
    "color_type": "default",
    "count_down": 0,
    "detail_desc_list": [
      "平台自动同意取消，加价金额已原路退回顾客"
    ],
    "detail_status_arr": [
      "平台自动同意取消，加价金额已原路退回顾客"
    ],
    "hover": false,
    "list_desc_list": [
      "平台自动同意取消，加价金额已原路退回顾客"
    ],
    "list_status_arr": [
      "平台自动同意取消，加价金额已原路退回顾客"
    ],
    "title": "已取消"
  }
}
```

### 注意

Error Unknown: Agent execution terminated due to error. (Error ID: c62c8d03-2724-457c-9329-a75e39364030-164)

`order_base_info.order_id` 是抖音平台的**交易订单号（主订单号 / 支付单号）**。

在抖音商家后台（来客后台）的界面上，它显示的名称就是**「订单编号」**。

---

### 一、抖音系统中的三个单号对照

你可以把抖音的订单系统理解为两层架构：**电商交易层**（管钱）和 **酒旅履约层**（管住）。

| 字段名 | 商家后台显示名称 | 角色 | 记录的核心信息 |
| :--- | :--- | :--- | :--- |
| **`order_base_info.order_id`** | **「订单编号」** | **交易/支付单号**<br>（电商层） | **资金与交易流**：<br>用户付款时间（`pay_time`）、实付金额（`pay_amount`）、支付优惠、发票开具等财务信息。 |
| **`book_detail_info.book_order_id`** | **「预约单号」** | **履约业务单号**<br>（酒旅层） | **客房预订业务**（仅预售券）：<br>入住日期、离店日期、入住房型、入住人姓名等。 |
| **`book_detail_info.book_id`** | - | **预约实例 ID**<br>（底层主键） | **底层数据实例主键**：<br>抖音数据库中客房预约记录的全局主键（日历房/套餐直接以此作为预订标识）。 |

---

### 二、为什么抖音要把 `order_id` 和 `book_order_id` 分开？

核心原因在于**预售券（房券）可以“一单多次预约”或者“买券后延期预约”**：

```mermaid
flowchart TD
    subgraph 电商交易层["【交易层】管支付、资金"]
        T["交易订单: order_base_info.order_id\n(例如买了一张通兑房券，实付 500 元)"]
    end

    subgraph 酒旅履约层["【履约层】管订房、入住"]
        B1["第 1 次预约: book_order_id (或 book_id)\n8月10日入住大床房 1 晚"]
        B2["取消后第 2 次预约: 产生新的 book_order_id\n8月20日入住大床房 1 晚"]
    end

    T -. 兑换预约 .-> B1
    T -. 再次预约 .-> B2
```

1. **钱是挂在 `order_base_info.order_id` 上的**：
   - 顾客在抖音 App 里付款、看微信/支付宝账单、申请开票，对应的都是这个 `order_base_info.order_id`。
2. **房间是挂在 `book_order_id` / `book_id` 上的**：
   - 顾客哪天来住、住什么房、几个晚上，对应的是预约单号。
   - 如果顾客买了预售券取消预约、再次预约，`order_base_info.order_id`（付款单）保持不变，但每次预约会产生新的 `book_order_id`。

---

